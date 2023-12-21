const path = require('path');
const fse = require('fs-extra');
const {v4: uuidV4} = require('uuid');
const {pipeline} = require('node:stream/promises');
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

  async put(stream) {
    const tempFile = path.join(this.#temp, uuidV4());
    const tempFileStream = fse.createWriteStream(tempFile);

    await pipeline(stream, tempFileStream);
    const hash = await fileChecksum(tempFile, {algorithm: 'sha256'});

    const directory = hash.substring(0, 2);
    const filename = hash.substring(2);

    fse.ensureDirSync(path.join(this.#objects, directory));
    fse.moveSync(tempFile, path.join(this.#objects, directory, filename));
    return hash;
  }

  delete(hash) {}

  get(hash) {
    let stream = 'mystream';
    return stream;
  }
}

module.exports = SHFS;
