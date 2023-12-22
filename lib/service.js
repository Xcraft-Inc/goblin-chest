// @ts-check
const path = require('path');
const {promisify} = require('util');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {getRoutingKey} = require('xcraft-core-host');

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
    const streamFS = this._backend.getWriteStream();
    const streamer = promisify(xcraftStream.streamer);
    await streamer(getRoutingKey(), streamFS.stream, null);
    const hash = await this._backend.put(streamFS);
    return hash;
  }

  async retrieve() {}
}

module.exports = {Chest, ChestLogic};
