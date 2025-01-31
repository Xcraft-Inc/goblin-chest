// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {string, enumeration} = require('xcraft-core-stones');

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}

class ChestAliasShape {
  id = string;
  meta = MetaShape;
  name = string;
}

class ChestAliasState extends Elf.Sculpt(ChestAliasShape) {}

class ChestAliasLogic extends Elf.Archetype {
  static db = 'chest';
  static indices = ['name'];
  state = new ChestAliasState({
    id: undefined,
    meta: {
      index: '',
      status: 'published',
    },
    name: undefined,
  });

  create(id, name) {
    const {state} = this;
    state.id = id;
    state.name = name;
  }

  upsert(name) {
    const {state} = this;
    state.name = name;
    state.meta.status = 'published';
  }

  trash() {
    const {state} = this;
    state.meta.status = 'trashed';
  }
}

class ChestAlias extends Elf {
  logic = Elf.getLogic(ChestAliasLogic);
  state = new ChestAliasState();

  /**
   * Create an alias (chest alias) entry based on a chest object
   * @param {*} id chestAlias@<...>
   * @param {*} desktopId desktop id
   * @param {*} name alias for the object
   * @returns {Promise<this>} this
   */
  async create(id, desktopId, name) {
    if (!name) {
      throw new Error('An name must be specified when a new alias is created');
    }

    this.logic.create(id, name);
    await this.persist();
    return this;
  }

  async upsert(name) {
    this.logic.upsert(name);
    await this.persist();
  }

  async trash() {
    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {
  ChestAlias,
  ChestAliasLogic,
  ChestAliasShape,
};
