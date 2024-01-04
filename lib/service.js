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

    // TODO: check integrity
  }

  /**
   * Supply a file to the Chest
   *
   * @param {*} xcraftStream File system path or stream
   * @param {string} [fileName] File's name
   * @param {string} [streamId] A specific streamId
   * @returns {Promise<string>} ChestObject id
   */
  async supply(xcraftStream, fileName, streamId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const streamFS = this._backend.getWriteStream();
    const streamer = promisify(xcraftStream.streamer);

    try {
      await streamer(getRoutingKey(), streamFS.stream, null);
    } catch (ex) {
      this._backend.onError(streamFS);
      throw ex;
    }
    const hash = await this._backend.put(streamFS);

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    try {
      const id = SmartId.from('chestObject', hash);
      const object = await new ChestObject(this).create(
        id,
        feedId,
        fileName || streamFS.file
      );
      await object.revive();
      return id;
    } catch (ex) {
      this._backend.del(hash);
      throw ex;
    }
  }

  /**
   * Retrieve a file from the Chest
   *
   * @param {string} chestObjectId ChestObject id
   * @returns {Promise<object>} Xcraft stream
   */
  async retrieve(chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const hash = chestObjectId.split('@')[1];
    const stream = await this._backend.get(hash);

    const chestObjectState = await this.cryo.getState(
      'chest',
      chestObjectId,
      'persist'
    );

    return {
      xcraftStream: stream,
      routingKey: getRoutingKey(),
      filename: chestObjectState.name,
    };
  }

  async trash(chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const exists = await this.cryo.isPersisted('chest', chestObjectId);
    if (!exists) {
      return;
    }

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));
    const object = await new ChestObject(this).create(chestObjectId, feedId);

    await object.trash();

    const hash = chestObjectId.split('@')[1];
    await this._backend.del(hash);
  }
}

module.exports = {Chest, ChestLogic};
