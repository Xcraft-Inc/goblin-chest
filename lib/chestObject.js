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

    /* Clean the fileName (remove drive and directories) */
    if (filePath) {
      const sanitize = require('sanitize-filename');
      filePath = sanitize(path.posix.basename(path.win32.basename(filePath)));
    }

    state.name = filePath;
    state.meta.index = state.name;
  }

  revive() {
    this.state.meta.status = 'published';
  }

  trash() {
    this.state.meta.status = 'trashed';
  }
}

class ChestObject extends Elf {
  logic = Elf.getLogic(ChestObjectLogic);
  state = new ChestObjectState();

  /**
   * Create a file (chest object) entry based on hash
   *
   * @param {*} id chestObject@<hash>
   * @param {*} desktopId desktop id
   * @param {*} [filePath] fullpath to file
   * @returns {Promise<this>} this
   */
  async create(id, desktopId, filePath) {
    if (!filePath) {
      throw new Error('A file must be specified when a new object is created');
    }

    this.logic.create(id, filePath);
    await this.persist();
    return this;
  }

  async revive() {
    this.logic.revive();
    await this.persist();
  }

  async trash() {
    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {ChestObject, ChestObjectLogic};
