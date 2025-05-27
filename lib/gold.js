// @ts-check

const {Elf} = require('xcraft-core-goblin');
const {enumeration, option} = require('xcraft-core-stones');
const {id} = require('xcraft-core-goblin/lib/types.js');
const {Chest} = require('./chest.js');
const {ChestAlias} = require('./chestAlias.js');
const path = require('node:path');

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

  update(chestAliasId) {
    const {state} = this;
    state.chestAliasId = chestAliasId;
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
    this.logic.create(id);
    await this.persist();
    return this;
  }

  async beforePersistOnServer() {
    const {state} = this;
  }

  async retrieve() {
    const {state} = this;
    if (!state.chestAliasId) {
      return;
    }

    const chest = new Chest(this);
    const chestObjectId = chestObjectFromAlias(state.chestAliasId);
    return await chest.locationTry(chestObjectId);
  }

  /**
   * Provide a file (or a new file) for this gold.
   * @param {string} file location on disk
   */
  async update(file) {
    const {state} = this;
    const chest = new Chest(this);
    const namespace = this.id;

    if (state.chestAliasId) {
      const chestObjectId = chestObjectFromAlias(state.chestAliasId);
      const exists = await chest.exists(chestObjectId, file);
      if (exists) {
        return;
      }
    }

    const chestAliasId = await chest.supply(
      file,
      null,
      null,
      null,
      null,
      namespace,
      path.basename(file)
    );
    this.logic.update(chestAliasId);
    await this.persist();
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
};
