// @ts-check
const path = require('path');
const {Elf} = require('xcraft-core-goblin');
const {string, enumeration} = require('xcraft-core-stones');

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}

class ChestObjectShape {
  id = string;
  meta = MetaShape;
  name = string;
}

class ChestObjectState extends Elf.Sculpt(ChestObjectShape) {}

class ChestObjectLogic extends Elf.Archetype {
  static db = 'chest';
  state = new ChestObjectState({
    meta: {
      index: '',
      status: 'published',
    },
  });

  create(id, filePath) {
    const {state} = this;
    state.id = id;
    state.name = path.basename(filePath);
    state.meta.index = state.name;
  }
}

class ChestObject extends Elf {
  state = new ChestObjectState();

  /**
   * Create a file (chest object) entry based on hash
   *
   * @param {*} id chestObject@<hash>
   * @param {*} desktopId
   * @param {*} filePath fullpath to file
   * @returns
   */
  async create(id, desktopId, filePath) {
    this.do();
    await this.persist();
    return this;
  }

  delete() {}
}

module.exports = {ChestObject, ChestObjectLogic};
