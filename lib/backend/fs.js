const path = require('path');
const fse = require('fs-extra');
const {v4: uuidV4} = require('uuid');
const {fileChecksum} = require('xcraft-core-utils/lib/file-crypto.js');

class SHFS {
  #root;
  #objects;
  #temp;

  constructor(config) {
    if (config?.fs?.location) {
      this.#root = config?.fs?.location;
    } else {
      const xConfig = require('xcraft-core-etc')().load('xcraft');
      const location = path.join(xConfig.xcraftRoot, 'var/chest');
      this.#root = location;
    }
    this.#objects = path.join(this.#root, 'objects');
    this.#temp = path.join(this.#root, 'temp');

    fse.ensureDirSync(this.#objects);
    fse.ensureDirSync(this.#temp);
  }

  #pathFromHash(hash) {
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

  async put(streamFS) {
    const hash = await fileChecksum(streamFS.file, {algorithm: 'sha256'});
    const directory = hash.substring(0, 2);

    fse.ensureDirSync(path.join(this.#objects, directory));
    try {
      fse.moveSync(streamFS.file, this.#pathFromHash(hash));
    } catch (ex) {
      if (ex.message !== 'dest already exists.') {
        throw ex;
      }
      fse.removeSync(streamFS.file);
    }
    return hash;
  }

  del(hash) {
    fse.removeSync(this.#pathFromHash(hash));
  }

  get(hash) {
    return fse.createReadStream(this.#pathFromHash(hash));
  }

  onError(streamFS) {
    fse.removeSync(streamFS.file);
  }
}

module.exports = SHFS;
