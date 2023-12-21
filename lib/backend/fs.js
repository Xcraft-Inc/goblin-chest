const path = require('path');

class SHFS {
  #location;

  constructor(config) {
    if (config?.fs?.location) {
      this.#location = config?.fs?.location;
    } else {
      const xConfig = require('xcraft-core-etc')().load('xcraft');
      const location = path.join(xConfig.xcraftRoot, 'var/chest');
      this.#location = location;
    }
  }

  put(stream) {
    let hash = 'toto';
    return hash;
  }

  delete(hash) {}

  get(hash) {
    let stream = 'mystream';
    return stream;
  }
}

module.exports = SHFS;
