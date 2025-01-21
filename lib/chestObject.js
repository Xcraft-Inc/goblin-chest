// @ts-check
const path = require('path');
const {Elf} = require('xcraft-core-goblin');
const {string, enumeration, number, option} = require('xcraft-core-stones');

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}

class EncryptionShape {
  cipher = enumeration('aes-256-cbc');
  compress = enumeration('gzip');
  key = string; /* It's the symmetric key + IV (encrypted with a public asymmetric key) */
}

class ChestObjectShape {
  id = string;
  meta = MetaShape;
  name = string;
  size = number;
  mime = string;
  charset = string;
  encryption = option(EncryptionShape);
  link = enumeration(
    'linked' /* A physical file must exist on the storage */,
    'unlinked' /* This entry can exists without physical file on the storage */
  );
  generation = number;
}

class ChestObjectState extends Elf.Sculpt(ChestObjectShape) {}

class ChestObjectLogic extends Elf.Archetype {
  static db = 'chest';
  static indices = ['name'];
  state = new ChestObjectState({
    id: undefined,
    meta: {
      index: '',
      status: 'published',
    },
    name: undefined,
    size: undefined,
    mime: undefined,
    charset: undefined,
    link: 'linked',
    generation: 0,
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

  upsert(size, mime, charset, cipher, compress, key, generation) {
    const {state} = this;
    state.size = size;
    state.mime = mime;
    state.charset = charset;
    if (cipher && key) {
      state.encryption = {cipher, compress, key};
    }
    state.generation = generation;
    this.state.meta.status = 'published';
  }

  unlink() {
    this.state.link = 'unlinked';
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
   * @param {*} [cipher] cipher used to encrypt
   * @param {*} [compress] compression algo used to encrypt
   * @param {*} [key] encryption key
   */
  async upsert(size, mime, charset, cipher, compress, key) {
    const {state} = this;

    const objects = await this.cryo.reader(ChestObjectLogic.db);
    const [nb] = objects
      .queryArchetype('chestObject', ChestObjectShape)
      .select((_, $) => [$.count()])
      .where((object) => object.get('name').eq(state.name))
      .get() || [0];
    let [max] = objects
      .queryArchetype('chestObject', ChestObjectShape)
      .select((object, $) => [$.max(object.get('generation'))])
      .where((object) => object.get('name').eq(state.name))
      .get() || [0];
    max++;

    const generation = max > nb ? max : nb;
    this.logic.upsert(size, mime, charset, cipher, compress, key, generation);
    await this.persist();
  }

  async unlink() {
    this.logic.unlink();
    await this.persist();
  }

  async trash() {
    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {ChestObject, ChestObjectLogic, ChestObjectShape};
