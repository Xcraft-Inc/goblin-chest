// @ts-check
const path = require('path');
const {promisify} = require('util');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {getRoutingKey} = require('xcraft-core-host');
const {ChestObject} = require('./chestObject.js');

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

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    const id = SmartId.from('chestObject', hash);
    await new ChestObject(this).create(id, feedId, streamFS.file);

    return id;
  }

  async retrieve() {}
}

module.exports = {Chest, ChestLogic};
