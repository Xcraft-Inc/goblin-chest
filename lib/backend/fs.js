const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {pipeline} = require('node:stream/promises');
const fse = require('fs-extra');
const {v4: uuidV4} = require('uuid');
const {lsall} = require('xcraft-core-fs');
const {fileChecksum} = require('xcraft-core-utils/lib/file-crypto.js');

class SHFS {
  #root;
  #objects;
  #temp;

  #maxSize;
  #totalSize;
  #index = new Map();
  #cipher;
  #ivLength = 16;
  #compress;

  constructor(config) {
    if (config?.location) {
      this.#root = config?.location;
    } else {
      const xConfig = require('xcraft-core-etc')().load('xcraft');
      const location = path.join(xConfig.xcraftRoot, 'var/chest');
      this.#root = location;
    }
    this.#objects = path.join(this.#root, 'objects');
    this.#temp = path.join(this.#root, 'temp');
    this.#maxSize = config?.maxSize || 0;
    this.#cipher = config?.cipher;
    this.#compress = config?.compress;

    fse.ensureDirSync(this.#objects);
    fse.removeSync(this.#temp);
    fse.ensureDirSync(this.#temp);

    this.#updateIndex();
    this.#rolling();
  }

  /* Build the index, ordered by atime */
  #updateIndex() {
    this.#totalSize = 0;
    lsall(this.#objects)
      .map((file) => ({file, st: fse.statSync(file)}))
      .filter(({st}) => !st.isDirectory())
      .sort(({st: stA}, {st: stB}) => stA.atime - stB.atime)
      .forEach(({file, st}) => {
        this.#totalSize += st.size;
        this.#index.set(file, {size: st.size, atime: st.atime});
      });
  }

  /* Remove older files until the maxSize is reached */
  #rolling() {
    if (!this.#maxSize) {
      return;
    }

    while (this.#totalSize > this.#maxSize) {
      const it = this.#index.entries().next();
      if (!it?.value) {
        return;
      }

      const file = it.value[0];
      let elems = file.split(path.sep);
      elems = elems.slice(elems.length - 2);
      const hash = elems.join('');
      this.del(hash);
    }
  }

  setMaxSize(maxSize) {
    this.#maxSize = maxSize;
    this.#rolling();
  }

  location(hash) {
    const directory = hash.substring(0, 2);
    const filename = hash.substring(2);
    return path.join(this.#objects, directory, filename);
  }

  getWriteStream() {
    const file = path.join(this.#temp, uuidV4());
    return {
      file,
      stream: fse.createWriteStream(file),
    };
  }

  async #encrypt(inputFile, outputStream, cert) {
    const inputStream = fse.createReadStream(inputFile);
    const iv = crypto.randomBytes(this.#ivLength);
    const [algo, length] = this.#cipher.split('-');
    const aesKey = crypto.generateKeySync(algo, {length: parseInt(length)});
    const encrypter = crypto.createCipheriv(this.#cipher, aesKey, iv);

    const pipes = [inputStream];
    if (this.#compress === 'gzip') {
      const gzip = zlib.createGzip();
      pipes.push(gzip);
    }

    pipes.push(encrypter, outputStream);
    await pipeline(...pipes);

    const publicKey = crypto.createPublicKey(cert);
    return crypto
      .publicEncrypt(
        {key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING},
        Buffer.concat([aesKey.export(), iv])
      )
      .toString('base64');
  }

  #decrypt(inputFile, encryption, key) {
    const privateKey = crypto.createPrivateKey(key);
    const aesKeyIV = crypto.privateDecrypt(
      privateKey,
      Buffer.from(encryption.key, 'base64')
    );
    const aesKey = Buffer.alloc(aesKeyIV.length - this.#ivLength);
    const iv = Buffer.alloc(this.#ivLength);
    aesKeyIV.copy(aesKey, 0, 0, aesKeyIV.length - this.#ivLength);
    aesKeyIV.copy(iv, 0, aesKeyIV.length - this.#ivLength);

    const inputStream = fse.createReadStream(inputFile);
    const decrypter = crypto.createDecipheriv(encryption.cipher, aesKey, iv);
    const pipes = inputStream.pipe(decrypter);

    if (encryption.compress === 'gzip') {
      const gunzip = zlib.createGunzip();
      return pipes.pipe(gunzip);
    }

    return pipes;
  }

  async hash(file) {
    return await fileChecksum(file, {algorithm: 'sha256'});
  }

  /**
   * @param {*} streamFS
   * @param {string|null} [cert]
   * @returns {*}
   */
  async put(streamFS, cert) {
    let file;
    let key;

    /* When we want to encrypt the file */
    if (cert) {
      const wStream = this.getWriteStream();
      try {
        key = await this.#encrypt(streamFS.file, wStream.stream, cert);
        file = wStream.file;
      } catch (ex) {
        this.onError(wStream);
        throw ex;
      } finally {
        await fse.remove(streamFS.file);
      }
    } else {
      file = streamFS.file;
    }

    const hash = await this.hash(file);
    const directory = hash.substring(0, 2);
    const object = this.location(hash);

    await fse.ensureDir(path.join(this.#objects, directory));
    try {
      await fse.move(file, object);
    } catch (ex) {
      if (ex.message !== 'dest already exists.') {
        throw ex;
      }
      await fse.remove(file);
    }

    /* Add into the index */
    const st = await fse.stat(object);
    this.#index.set(object, {size: st.size, atime: st.atime});
    const {size} = st;
    this.#totalSize += size;
    this.#rolling();

    return {hash, size, key, cipher: this.#cipher, compress: this.#compress};
  }

  async del(hash) {
    const object = this.location(hash);
    await fse.remove(object);

    /* Remove from the index */
    if (this.#index.has(object)) {
      this.#totalSize -= this.#index.get(object).size;
      this.#index.delete(object);
    }
  }

  /**
   * @param {string} hash
   * @param {object} [encryption]
   * @param {string|null} [key]
   * @returns {import('fs').ReadStream}
   */
  get(hash, encryption, key) {
    const inputFile = this.location(hash);
    const rStream = fse.createReadStream(inputFile);
    if (!encryption || !key) {
      return rStream;
    }

    /* When we want to decrypt the file */
    return this.#decrypt(inputFile, encryption, key);
  }

  async exists(hash) {
    try {
      await fse.access(this.location(hash), fse.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async onError(streamFS) {
    await fse.remove(streamFS.file);
  }

  *list() {
    for (const file of this.#index.keys()) {
      const hash = file.split(path.sep).slice(-2).join('');
      yield hash;
    }
  }
}

module.exports = SHFS;
