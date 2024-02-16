// @ts-check
const path = require('path');
const {Elf} = require('xcraft-core-goblin');
const {string, enumeration, number} = require('xcraft-core-stones');

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}

class ChestObjectShape {
  id = string;
  meta = MetaShape;
  name = string;
  size = number;
  mime = string;
  charset = string;
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

  upsert(size, mime, charset) {
    const {state} = this;
    state.size = size;
    state.mime = mime;
    state.charset = charset;
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
    /* persist only if upsert is called */
    return this;
  }

  /* Check if the file for this chestObject.id exists.
   * If it's not the case, we send back an event where we
   * ask clients to provide an xcraftStream with this file.
   */
  async beforePersistOnServer() {
    const {state} = this;

    const {Chest} = require('./chest.js');
    const chest = new Chest(this);

    await chest.checkMissing(state.id);
  }

  /**
   * @param {*} [size] file size
   * @param {*} [mime] mime type
   * @param {*} [charset] charset used
   */
  async upsert(size, mime, charset) {
    this.logic.upsert(size, mime, charset);
    await this.persist();
  }

  async trash() {
    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {ChestObject, ChestObjectLogic};
