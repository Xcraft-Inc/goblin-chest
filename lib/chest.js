// @ts-check
const path = require('path');
const {promisify} = require('util');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string, option, boolean} = require('xcraft-core-stones');
const {getRoutingKey} = require('xcraft-core-host');
const locks = require('xcraft-core-utils/lib/locks.js');
const files = require('xcraft-core-utils/lib/files.js');
const {Chronomancer} = require('goblin-chronomancer');
const {
  ChestObject,
  ChestObjectLogic,
  ChestObjectShape,
} = require('./chestObject.js');
const {ChestAliasShape, ChestAlias} = require('./chestAlias.js');
const Goblin = require('xcraft-core-goblin');

class ChestShape {
  id = string;
}

class ChestState extends Elf.Sculpt(ChestShape) {}

class ChestLogic extends Elf.Spirit {
  state = new ChestState({
    id: 'chest',
  });
}

class ChestOptions {
  replica = option(boolean);
}

class Chest extends Elf.Alone {
  /** @type {import("./backend/fs.js")} */ _backend;
  /** @private */ _isClient;
  /** @private */ _missingAttempts = {};

  /**
   * @param {t<ChestOptions>} [options] Chest's options
   */
  async init(options) {
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
      const backendConfig = {...(chestConfig[chestConfig.backend] || {})};
      if (options?.replica) {
        backendConfig.maxSize = 0;
      }
      this._backend = new backend(backendConfig);
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

    /* Server side or replica mode */
    if (!this._isClient || options?.replica) {
      await this.setReplica(true);
    }

    await this._collect();
  }

  async setReplica(enable) {
    const chestConfig = require('xcraft-core-etc')().load('goblin-chest');

    const maxSize = !enable
      ? chestConfig[chestConfig.backend]?.maxSize || 0
      : 0;
    this._backend.setMaxSize(maxSize);

    const chronomancer = new Chronomancer(this);

    if (!enable) {
      await chronomancer.stop('chest');
      await chronomancer.stop('chestCollect');
      return;
    }

    let time;

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

    await this._checkForMissing();
  }

  /** @private */
  async _collect() {
    if (!this._backend) {
      throw new Error(`The Chest is not initialized`);
    }

    for (const hash of this._backend.list()) {
      const id = SmartId.from('chestObject', hash);
      const props = await this.cryo.pickAction(ChestObjectLogic.db, id, [
        'meta.status',
        'link',
      ]);
      if (
        !props ||
        props['meta.status'] === 'trashed' ||
        props.link === 'unlinked'
      ) {
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
      if (this._isClient) {
        try {
          const location = await this.locationTry(chestObjectId);
          if (!location) {
            this.log.warn(
              `Skip all pending checks for missing objects since the server is unavailable`
            );
            break;
          }
        } catch (ex) {
          this.log.err(
            `Skip ${chestObjectId} and continue with the next object`,
            ex.stack || ex.message || ex
          );
        }
        continue;
      }

      /* Server side */
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
   * Collect all ChestObjects that are no longer referenced somwewhere (orphans)
   * TODO: WORK IN PROGRESS
   * @private
   */
  async _collectOrphans() {
    const dbs = Goblin.getAllRipleyDB().filter(
      (db) => db !== ChestObjectLogic.db
    );
    const references = new Set();
    const orphans = new Set();

    /* Populate the references Set */
    const searchFor = async (db) => {
      const objects = this.cryo.searchRaw(
        db,
        '*chestObject@*',
        /(?:^|[^@])(chestObject@[0-9a-f]+)/g /* Refs by SmartId are skipped by this regex */,
        false
      );
      for await (const list of objects) {
        if (!list) {
          continue;
        }
        for (const objectId of list) {
          references.add(objectId);
        }
      }
    };

    for (const db of dbs) {
      await searchFor(db);
    }

    /* Search for orphans (not referenced) */
    const reader = await this.cryo.reader(ChestObjectLogic.db);
    const stmt = reader
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id');
    for (const object of stmt.iterate()) {
      if (!references.has(object)) {
        orphans.add(object);
      }
    }

    if (!orphans.size) {
      return; /* All ChestObjects are referenced somewhere */
    }

    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    for (const objectId of orphans) {
      const aliasId = reader
        .queryArchetype('chestAlias', ChestAliasShape)
        .field('id')
        .where((alias) => alias.get('id').glob(`*@${objectId}`))
        .limit(1)
        .get();
      if (aliasId) {
        continue; /* At least one ChestAlias ref, it's not an orphan then continue */
      }

      this.log.dbg(`[collector] trash orphan ${objectId}`);

      /* Trash orphan */
      //const object = await new ChestObject(this).create(objectId, feedId);
      //await object.trash();
    }
  }

  /**
   * Supply a file to the Chest
   *
   * It returns the ChestAlias id if a namespace and alias are specified.
   * @param {*} xcraftStream File system path or stream
   * @param {string|null} [fileName] File's name
   * @param {string|null} [streamId] A specific streamId
   * @param {string|null} [chestObjectId] The related chestObjectId (mostly internal)
   * @param {string|null} [cert] A public certificate for the encryption
   * @param {string|null} [namespace] A namespace for alias
   * @param {string|null} [alias] the alias name
   * @returns {Promise<string>} ChestAlias id or ChestObject id
   */
  async supply(
    xcraftStream,
    fileName,
    streamId,
    chestObjectId,
    cert,
    namespace,
    alias
  ) {
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
      let chestAlias;
      const name = fileName || streamFS.file;
      const id = SmartId.from('chestObject', hash);
      const object = await new ChestObject(this).create(id, feedId, name);
      if (namespace) {
        chestAlias = await object.setAlias(namespace, alias || name);
      }
      await object.upsert(size, mime, charset, cipher, compress, key);
      return chestAlias || id;
    } catch (ex) {
      this._backend.del(hash);
      throw ex;
    }
  }

  /**
   * Retrieve a file from the Chest
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
      ChestObjectShape
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

  async trashAlias(chestAliasId) {
    const feedId = Elf.createFeed();
    this.quest.defer(async () => await this.killFeed(feedId));

    const alias = await new ChestAlias(this).create(chestAliasId, feedId);
    await alias.trash();
  }

  /**
   * Trash a file from the Chest
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

  /**
   * Unlink a file from the Chest
   * @param {*} chestObjectId ChestObject id
   */
  async unlink(chestObjectId) {
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

    await object.unlink();

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

  /**
   * Retrieve a chestObjectId from a name
   *
   * It returns the object id of the greater generation.
   * @param {string} name
   * @returns {Promise<*>} chestObjectId
   */
  async getObjectIdFromName(name) {
    /* Retrieve the chestObjectId according to the name */
    const objects = await this.cryo.reader(ChestObjectLogic.db);
    const chestObjectId = objects
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id')
      .where((object) => object.get('name').eq(name))
      .orderBy((object, $) => $.desc(object.get('generation')))
      .limit(1)
      .get();
    return chestObjectId;
  }

  /**
   * Retrieve chestObjectIds from a name
   *
   * It returns the object ids of "limit" last generations.
   * @param {string} name
   * @param {number} limit how many previous versions (10 by default)
   * @returns {Promise<string[]>} chestObjectId
   */
  async getObjectIdHistoryFromName(name, limit = 10) {
    if (limit < 1) {
      throw new Error(
        `the limit argument must be greater or equal to 1, actual: ${limit}`
      );
    }
    /* Retrieve chestObjectIds according to the name */
    const objects = await this.cryo.reader(ChestObjectLogic.db);
    return objects
      .queryArchetype('chestObject', ChestObjectShape)
      .field('id')
      .where((object) => object.get('name').eq(name))
      .orderBy((object, $) => $.desc(object.get('generation')))
      .limit(limit)
      .all();
  }

  /**
   * Retrieve the list of chestAlias according to a namespace
   *
   * With a depth larger than 1, previous revisions of the documents
   * are provided in order (index 0 is the latest).
   * @param {string} namespace chestAlias namespace
   * @param {number} depth how much revisions
   * @returns {Promise<string[][]>}
   */
  async getAliasIdsFromNamespace(namespace, depth = 1) {
    const reader = await this.cryo.reader(ChestObjectLogic.db);

    /* Retrieve all aliases in this namespace */
    const alias = reader
      .queryArchetype('chestAlias', ChestAliasShape)
      .fields(['id', 'name'])
      .where((object) => object.get('id').glob(`chestAlias@${namespace}@*`))
      .all();

    /* Group chestAlias id by name */
    const groups = alias.reduce((agg, {id, name}) => {
      if (!agg[name]) {
        agg[name] = [];
      }
      agg[name].push(id);
      return agg;
    }, {});

    /* Retrieve the latest chestObject of each group */
    for (const group of Object.entries(groups)) {
      const [name, aliasIds] = group;
      if (aliasIds.length < 2) {
        groups[name] = [aliasIds[0]];
        continue;
      }

      const objectId = aliasIds.map((aliasId) =>
        aliasId.split('@').splice(-2).join('@')
      );
      groups[name] = reader
        .queryArchetype('chestObject', ChestObjectShape)
        .field('id')
        .where((object) => object.get('id').in(objectId))
        .orderBy((object, $) => $.desc(object.get('generation')))
        .limit(depth)
        .all()
        .map((objectId) => `chestAlias@${namespace}@${objectId}`);
    }

    return Object.values(groups);
  }
}

module.exports = {Chest, ChestLogic};
