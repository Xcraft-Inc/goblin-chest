// @ts-check
const path = require('path');
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
  /** @private */ _isClient;
  /** @private */ _missingAttempts = {};

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

    this._isClient = goblinConfig.actionsSync?.enable;

    /* Client side */
    if (this._isClient) {
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
    if (!this._isClient) {
      let time;
      const chronomancer = new Chronomancer(this);

      ({time} = chestConfig.chronomancer.missing);
      if (time) {
        await chronomancer.upsert('chest', time, 'chest._checkForMissing');
        await chronomancer.restart('chest');
      }

      ({time} = chestConfig.chronomancer.collect);
      if (time) {
        await chronomancer.upsert('chestCollect', time, 'chest._collect');
        await chronomancer.restart('chestCollect');
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
      .where((o) => o.get('link').neq('unlinked'))
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
   * @param {string|null} [cert] A public certificate for the encryption
   * @returns {Promise<string>} ChestObject id
   */
  async supply(xcraftStream, fileName, streamId, chestObjectId, cert) {
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
    const {hash, size, key, cipher, compress} = await this._backend.put(
      streamFS,
      cert
    );

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    try {
      const id = SmartId.from('chestObject', hash);
      const object = await new ChestObject(this).create(
        id,
        feedId,
        fileName || streamFS.file
      );
      await object.upsert(size, mime, charset, cipher, compress, key);
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
   * @param {string|null} [key] A private key for the decryption
   * @returns {Promise<object>} Xcraft stream
   */
  async retrieve(chestObjectId, key) {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    const hash = chestObjectId.split('@')[1];
    const exists = this._backend.exists(hash);
    if (!exists) {
      await this.checkMissing(chestObjectId);
      throw new Error(`File ${chestObjectId} is not known by the chest`);
    }

    const chestObjectState = await this.cryo.getState(
      'chest',
      chestObjectId,
      'persist'
    );
    if (!chestObjectState) {
      throw new Error(
        `The file ${chestObjectId} is not known by the database (not synced?)`
      );
    }
    const stream = this._backend.get(hash, chestObjectState.encryption, key);

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
   * Try to get location from a chest object
   *
   * If the local chest doesn't have this object, it asks the server
   * for a stream via the retrieve quest. Then the location can be
   * provided to the client.
   *
   * But if we are on the server side and the object is not known, then
   * we ask to all connected clients if someone knows this object.
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

    /* For the server side */
    if (!this._isClient) {
      /* Maybe a client is connected and knows something about this object
       * then give a chance to retrieve this one.
       */
      if (this._missingAttempts[chestObjectId]) {
        --this._missingAttempts[chestObjectId];
        if (this._missingAttempts[chestObjectId] === 0) {
          delete this._missingAttempts[chestObjectId];
          throw new Error(
            `File ${chestObjectId} is not known by the chest, no more attempts`
          );
        }
      } else {
        this._missingAttempts[chestObjectId] = 60;
      }

      if (this._missingAttempts[chestObjectId] % 10 === 0) {
        this.log.warn(
          `File ${chestObjectId} is not known by the chest, continue attempts for ${
            this._missingAttempts[chestObjectId] / 2
          }s`
        );
      }
      await this.checkMissing(chestObjectId);

      /* Wait a bit and retry again */
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.locationTry(chestObjectId);
    }

    /* For the client side */
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

    const {hash: newHash} = await this._backend.put(streamFS);
    if (newHash !== hash) {
      this._backend.del(newHash);
      throw new Error(`Bad retrieved file, ${newHash} != ${hash}`);
    }
    return this._backend.location(hash);
  }

  async saveAsTry(chestObjectId, outputFile, privateKey) {
    const fse = require('fs-extra');

    const location = await this.locationTry(chestObjectId);
    if (!location) {
      throw new Error(
        `Impossible to retrieve the location of ${chestObjectId}`
      );
    }

    const {xcraftStream, routingKey} = await this.retrieve(
      chestObjectId,
      privateKey
    );

    const streamer = promisify(xcraftStream.streamer);
    const tempFile = fse.createWriteStream(outputFile);
    try {
      await streamer(routingKey, tempFile, null);
    } finally {
      tempFile.close();
    }
  }

  /**
   * Trash a file from the Chest
   *
   * @param {*} chestObjectId ChestObject id
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
