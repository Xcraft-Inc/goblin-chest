// @ts-check
const path = require('path');
const fse = require('fs-extra');
const {promisify} = require('util');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {getRoutingKey} = require('xcraft-core-host');
const {files} = require('xcraft-core-utils');
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
  /** @type {import("./backend/fs.js")} */ _backend;

  async init() {
    const storeConfig = require('xcraft-core-etc')().load('goblin-chest');
    const goblinConfig = require('xcraft-core-etc')().load(
      'xcraft-core-goblin'
    );

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

    const syncClientEnabled = goblinConfig.actionsSync?.enable;
    if (syncClientEnabled) {
      this.quest.sub(`*::chest.missing-file-needed`, async (_, {msg}) => {
        if (!this._backend) {
          return; /* not ready */
        }

        const {chestObjectId} = msg.data;
        const hash = chestObjectId.split('@')[1];
        const exists = this._backend.exists(hash);
        if (!exists) {
          return; /* not ours */
        }

        this.log.dbg(`Provide ${chestObjectId} to the server`);
        const stream = this._backend.get(hash);
        const bus = {rpc: true};
        const chest = new Chest(this, {bus});
        await chest.supply(stream);
      });
    }

    // TODO: check integrity and check availability of all entries in the database
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
    const {mime, charset} = await files.getMimeType(streamFS.file);
    const {size} = fse.statSync(streamFS.file);
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
      await object.upsert(size, mime, charset);
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
    const stream = this._backend.get(hash);

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

  /**
   * Get location from a chest object
   *
   * @param {string} chestObjectId ChestObject id
   * @returns {Promise<object>} The location
   */
  async location(chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const hash = chestObjectId.split('@')[1];
    return this._backend.location(hash);
  }

  /**
   * Trash a file from the Chest
   *
   * @param {string} chestObjectId ChestObject id
   */
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
    this._backend.del(hash);
  }

  async checkMissing(chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const hash = chestObjectId.split('@')[1];
    const exists = this._backend.exists(hash);
    if (exists) {
      return;
    }

    this.log.dbg(`Server ask for ${chestObjectId}`);
    this.quest.evt('missing-file-needed', {chestObjectId, _xcraftRPC: true});
  }
}

module.exports = {Chest, ChestLogic};
