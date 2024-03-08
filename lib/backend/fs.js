const path = require('path');
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
    this.#maxSize = config?.fs?.maxSize || 0;

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
        this.#index.set(file, st);
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

  async put(streamFS) {
    const hash = await fileChecksum(streamFS.file, {algorithm: 'sha256'});
    const directory = hash.substring(0, 2);
    const object = this.location(hash);

    fse.ensureDirSync(path.join(this.#objects, directory));
    try {
      fse.moveSync(streamFS.file, object);
    } catch (ex) {
      if (ex.message !== 'dest already exists.') {
        throw ex;
      }
      fse.removeSync(streamFS.file);
    }

    /* Add into the index */
    const st = fse.statSync(object);
    this.#index.set(object, st);
    this.#totalSize += st.size;
    this.#rolling();

    return hash;
  }

  del(hash) {
    const object = this.location(hash);
    fse.removeSync(object);

    /* Remove from the index */
    if (this.#index.has(object)) {
      this.#totalSize -= this.#index.get(object).size;
      this.#index.delete(object);
    }
  }

  get(hash) {
    return fse.createReadStream(this.location(hash));
  }

  exists(hash) {
    return fse.existsSync(this.location(hash));
  }

  onError(streamFS) {
    fse.removeSync(streamFS.file);
  }
}

module.exports = SHFS;
