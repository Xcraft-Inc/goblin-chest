// @ts-check

const {Elf} = require('xcraft-core-goblin');
const {enumeration} = require('xcraft-core-stones');
const {id} = require('xcraft-core-goblin/lib/types.js');

class MetaShape {
  status = enumeration('published', 'trashed');
}

class GoldShape {
  id = id('gold');
  meta = MetaShape;
}

class GoldState extends Elf.Sculpt(GoldShape) {}

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

  update() {
    const {state} = this;
  }

  trash() {
    const {state} = this;
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

  async load() {}

  async update(file) {
    this.logic.update();
    await this.persist();
  }

  async trash() {
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
