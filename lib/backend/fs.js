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
    const filename = hash.substring(2);

    fse.ensureDirSync(path.join(this.#objects, directory));
    fse.moveSync(streamFS.file, path.join(this.#objects, directory, filename));
    return hash;
  }

  delete(hash) {}

  get(hash) {
    let stream = 'mystream';
    return stream;
  }
}

module.exports = SHFS;
