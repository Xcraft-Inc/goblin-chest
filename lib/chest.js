// @ts-check
const path = require('path');
const fse = require('fs-extra');
const {promisify} = require('util');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const {getRoutingKey} = require('xcraft-core-host');
const {files, locks} = require('xcraft-core-utils');
const {Chronomancer} = require('goblin-chronomancer');
const {
  ChestObject,
  ChestObjectLogic,
  ChestObjectShape,
} = require('./chestObject.js');

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
    const chestConfig = require('xcraft-core-etc')().load('goblin-chest');
    const goblinConfig = require('xcraft-core-etc')().load(
      'xcraft-core-goblin'
    );

    try {
      const backend = require(path.join(
        __dirname,
        'backend',
        chestConfig.backend
      ));
      this._backend = new backend(chestConfig);
    } catch (ex) {
      if (ex.code === 'MODULE_NOT_FOUND') {
        throw new Error(`Chest backend "${chestConfig.backend}" not found`);
      }
      throw ex;
    }

    const syncClientEnabled = goblinConfig.actionsSync?.enable;

    /* Client side */
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
        await chest.supply(stream, null, null, chestObjectId);
      });
    }

    /* Server side */
    if (!syncClientEnabled) {
      const chronomancer = new Chronomancer(this);
      const running = await chronomancer.running('chest');
      const {time} = chestConfig.chronomancer;
      if (!running && time) {
        await chronomancer.upsert('chest', time, 'chest._checkForMissing');
        await chronomancer.start('chest');
      }
    }

    await this._collect();
  }

  /** @private */
  async _collect() {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    for (const hash of this._backend.list()) {
      const id = SmartId.from('chestObject', hash);
      const isPublished = await this.cryo.isPublished(ChestObjectLogic.db, id);
      if (!isPublished) {
        this._backend.del(hash);
      }
    }
  }

  /** @private */
  async _checkForMissing() {
    const reader = await this.cryo.reader(ChestObjectLogic.db);
    const objects = reader
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id')
      .iterate();
    for (const chestObjectId of objects) {
      const hash = chestObjectId.split('@')[1];
      const exists = this._backend.exists(hash);
      if (exists) {
        continue;
      }

      this.log.dbg(`Server ask for ${chestObjectId}`);
      this.quest.evt('missing-file-needed', {
        chestObjectId,
        _xcraftRPC: true,
      });
    }
  }

  /**
   * Supply a file to the Chest
   *
   * @param {*} xcraftStream File system path or stream
   * @param {string|null} [fileName] File's name
   * @param {string|null} [streamId] A specific streamId
   * @param {string|null} [chestObjectId] The related chestObjectId (mostly internal)
   * @returns {Promise<string>} ChestObject id
   */
  async supply(xcraftStream, fileName, streamId, chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    if (chestObjectId) {
      const supplyLock = locks.getMutex;
      await supplyLock.lock(`chest-supply-${chestObjectId}`);
      this.quest.defer(() =>
        supplyLock.unlock(`chest-supply-${chestObjectId}`)
      );

      const hash = chestObjectId.split('@')[1];
      const exists = this._backend.exists(hash);
      if (exists) {
        return chestObjectId;
      }
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
    const exists = this._backend.exists(hash);
    if (!exists) {
      await this.checkMissing(chestObjectId);
      throw new Error(`File ${chestObjectId} is not known by the chest`);
    }
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
   * Get location from a chest object even if exists only on the server side
   *
   * If the local chest doesn't have this object, it asks the server
   * for a stream via the retrieve quest. Then the location can be
   * provided to the client.
   *
   * @param {string} chestObjectId
   * @returns {Promise<object>} The location
   */
  async locationTry(chestObjectId) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const hash = chestObjectId.split('@')[1];
    if (this._backend.exists(hash)) {
      return this._backend.location(hash);
    }

    let xcraftStream;
    let routingKey;
    const bus = {rpc: true};
    const chest = new Chest(this, {bus});
    try {
      ({xcraftStream, routingKey} = await chest.retrieve(chestObjectId));
    } catch (ex) {
      this.log.warn(ex.stack || ex.message || ex);
      return null;
    }

    const streamFS = this._backend.getWriteStream();
    const streamer = promisify(xcraftStream.streamer);
    try {
      await streamer(routingKey, streamFS.stream, null);
    } catch (ex) {
      this._backend.onError(streamFS);
      throw ex;
    }

    const newHash = await this._backend.put(streamFS);
    if (newHash !== hash) {
      this._backend.del(newHash);
      throw new Error(`Bad retrieved file, ${newHash} != ${hash}`);
    }
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
