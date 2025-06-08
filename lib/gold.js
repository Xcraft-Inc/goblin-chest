// @ts-check

const {Elf, SmartId} = require('xcraft-core-goblin');
const {enumeration, option} = require('xcraft-core-stones');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {Chest} = require('./chest.js');
const {ChestAlias} = require('./chestAlias.js');
const {Readable} = require('node:stream');
const path = require('node:path');
const fse = require('fs-extra');

function goldIdFromFile(file) {
  const items = file.split(path.sep);
  return SmartId.from('gold', items.map(SmartId.encode).join('@'), false);
}

function fileFromGoldId(goldId) {
  const items = goldId.split('@').slice(1).map(SmartId.decode);
  if (items.some((item) => item === '..')) {
    throw new Error(`Relative paths are forbidden in goldId: ${id}`);
  }
  return items.join(path.sep);
}

class MetaShape {
  status = enumeration('published', 'trashed');
}

class GoldShape {
  id = id('gold');
  chestAliasId = option(id('chestAlias'));
  meta = MetaShape;
}

class GoldState extends Elf.Sculpt(GoldShape) {}

function chestObjectFromAlias(chestAliasId) {
  return chestAliasId.split('@').slice(-2).join('@');
}

class GoldLogic extends Elf.Archetype {
  static db = 'chest';
  static indices = ['id'];
  state = new GoldState({
    id: undefined,
    meta: {
      status: 'published',
    },
  });

  create(id) {
    const {state} = this;
    state.id = id;
  }

  provide(chestAliasId) {
    const {state} = this;
    state.chestAliasId = chestAliasId;
    state.meta.status = 'published';
  }

  update(chestAliasId) {
    const {state} = this;
    state.chestAliasId = chestAliasId;
    state.meta.status = 'published';
  }

  trash() {
    const {state} = this;
    state.chestAliasId = null;
    state.meta.status = 'trashed';
  }
}

class Gold extends Elf {
  logic = Elf.getLogic(GoldLogic);
  state = new GoldState();

  async create(id, desktopId) {
    fileFromGoldId(id);
    this.logic.create(id);
    /* persist only if provide or update is called */
    return this;
  }

  async beforePersistOnServer() {
    const {state} = this;
    if (!state.chestAliasId) {
      return;
    }

    const {GoldWarden} = require('./goldWarden.js');
    const goldWarden = new GoldWarden(this);
    const repository = await goldWarden.repository();
    if (!repository) {
      return;
    }

    /* Update the files in the Git repository, Gold Warden will
     * detects these changes accordingly.
     */
    const outputFile = path.join(repository, fileFromGoldId(this.id));
    if (state.meta.status === 'published') {
      const {pipeline} = require('node:stream/promises');
      const chest = new Chest(this);
      const inputFile = await chest.locationTry(
        chestObjectFromAlias(state.chestAliasId)
      );
      const writeStream = fse.createWriteStream(outputFile);
      const readStream = fse.createReadStream(inputFile);
      await pipeline(readStream, writeStream);
    } else if (state.meta.status === 'trashed') {
      await fse.remove(outputFile);
    }
  }

  /**
   * Retrieve the location of the file for this Gold
   *
   * It retrieves the file from the chest.
   * @returns {Promise<string|null>} location
   */
  async retrieve() {
    const {state} = this;

    if (!state.chestAliasId) {
      const {GoldWarden} = require('./goldWarden.js');
      const goldWarden = new GoldWarden(this);
      const repository = await goldWarden.repository();
      if (repository) {
        return null; /* Doesn't exists anymore (the Gold Warden is enabled) */
      }

      /* Fallback on the read-only "share" if the Gold Warden is disabled */
      const chestConfig = require('xcraft-core-etc')().load('goblin-chest');
      const {readonlyShare} = chestConfig.gold;
      if (!readonlyShare) {
        return null;
      }
      const file = path.join(readonlyShare, fileFromGoldId(this.id));
      try {
        await fse.access(file, fse.constants.F_OK);
      } catch {
        return null;
      }

      /* Provide explicitly this file instead of Gold Warden */
      await this.provide(file);
    }

    const chest = new Chest(this);
    const chestObjectId = chestObjectFromAlias(state.chestAliasId);
    return await chest.locationTry(chestObjectId);
  }

  /**
   * Provide a file (or a new file) for this gold.
   *
   * This quest should be used only by the Gold Warden. Its purpose is to
   * provide detected files from the repository.
   * @param {string} filePath location on disk
   */
  async provide(filePath) {
    const {state} = this;
    const chest = new Chest(this);

    /* Prevent useless supply when the Gold Warden is calling this quest
     * for each discovered files.
     */
    if (state.chestAliasId) {
      const chestObjectId = chestObjectFromAlias(state.chestAliasId);
      const exists = await chest.exists(chestObjectId, filePath);
      if (exists) {
        this.logic.provide(state.chestAliasId); /* Revive if trashed */
        await this.persist();
        return;
      }
    }

    const namespace = this.id;
    const chestAliasId = await chest.supply(
      filePath,
      null,
      null,
      null,
      null,
      namespace,
      fileFromGoldId(this.id)
    );
    if (state.chestAliasId && chestAliasId !== state.chestAliasId) {
      await chest.trashAlias(state.chestAliasId);
    }
    this.logic.provide(chestAliasId);
    await this.persist();
  }

  /**
   * Update the data of a file linked with this Gold
   *
   * The file must already exists, otherwise it fails.
   * @param {*} data
   * @returns {Promise<boolean>} false if this Gold is "empty"
   */
  async update(data) {
    const {state} = this;
    if (!data || !state.chestAliasId) {
      return false;
    }

    /* When the Gold Warden repository is available, the client and
     * the server will just write the file at the appropriate location.
     */
    const {GoldWarden} = require('./goldWarden.js');
    const goldWarden = new GoldWarden(this);
    const repository = await goldWarden.repository();
    if (repository) {
      const file = path.join(repository, fileFromGoldId(this.id));
      await fse.writeFile(file, data);
      return true;
    }

    /* Without the Gold Warden, the client updates the chestObject as
     * usual and a beforePersistOnServer hook will update the new file
     * in the repository.
     */
    const chest = new Chest(this);
    const namespace = this.id;

    const stream = new Readable();
    stream.push(data);
    stream.push(null);

    const chestAliasId = await chest.supply(
      stream,
      null,
      null,
      null,
      null,
      namespace,
      fileFromGoldId(this.id)
    );
    if (state.chestAliasId && chestAliasId !== state.chestAliasId) {
      await chest.trashAlias(state.chestAliasId);
    }
    this.logic.update(chestAliasId);
    await this.persist();
    return true;
  }

  async trash() {
    const {state} = this;
    const feedId = await this.newQuestFeed();
    if (state.chestAliasId) {
      const alias = await new ChestAlias(this).create(
        state.chestAliasId,
        feedId
      );
      await alias.trash();
    }
    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {
  Gold,
  GoldLogic,
  GoldShape,
  goldIdFromFile,
  fileFromGoldId,
};
