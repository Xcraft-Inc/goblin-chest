// @ts-check
const path = require('path');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');

class ChestShape {
  id = string;
}

class ChestState extends Elf.Sculpt(ChestShape) {}

class ChestLogic extends Elf.Spirit {
  state = new ChestState({
    id: 'chest',
  });
}

class Chest extends Elf.Alone {
  _backend;

  async init() {
    const storeConfig = require('xcraft-core-etc')().load('goblin-chest');

    try {
      const backend = require(path.join(
        __dirname,
        'backend',
        storeConfig.backend
      ));
      this._backend = new backend(storeConfig);
    } catch (ex) {
      if (ex.code === 'MODULE_NOT_FOUND') {
        throw new Error(`Chest backend "${storeConfig.backend}" not found`);
      }
      throw ex;
    }
  }

  async supply(xcraftStream) {
    const stream = xcraftStream.getStream();
    const hash = this._backend.put(stream);
    return hash;
  }

  async retrieve() {}
}

module.exports = {Chest, ChestLogic};
