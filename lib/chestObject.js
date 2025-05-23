// @ts-check
const path = require('node:path');
const {Elf} = require('xcraft-core-goblin');
const {
  string,
  enumeration,
  number,
  option,
  array,
  dateTime,
  record,
} = require('xcraft-core-stones');
const {ChestAlias, ChestAliasShape} = require('./chestAlias.js');
const {id} = require('xcraft-core-goblin/lib/types.js');

class MetaShape {
  index = string;
  vectors = option(record(string, array(number))); /* '0': [], '1': [] */
  status = enumeration('published', 'trashed');
}

class EncryptionShape {
  cipher = enumeration('aes-256-cbc');
  compress = enumeration('gzip');
  key = string; /* It's the symmetric key + IV (encrypted with a public asymmetric key) */
}

class MetadataShape {
  title = option(string);
  subject = option(string);
  description = option(string);
  languages = option(array(string));
  createDate = option(dateTime);
  modifyDate = option(dateTime);
  authors = option(array(string));
  contributors = option(array(string));
  version = option(string);
}

class ChestObjectShape {
  id = id('chestObject');
  meta = MetaShape;
  name = string;
  ext = option(string);
  size = number;
  mime = string;
  charset = string;
  encryption = option(EncryptionShape);
  link = enumeration(
    'linked' /* A physical file must exist on the storage */,
    'unlinked' /* This entry can exists without physical file on the storage */
  );
  generation = number;
  metadata = option(MetadataShape);
}

function sanitizeName(filePath) {
  const sanitize = require('sanitize-filename');
  return sanitize(path.posix.basename(path.win32.basename(filePath)));
}

class ChestObjectState extends Elf.Sculpt(ChestObjectShape) {}

function testExtension(ext) {
  return ext &&
    ext.length < 16 &&
    /^[a-z0-9]+$/.test(ext) &&
    !/^[0-9]+$/.test(ext)
    ? true
    : false;
}

function tryGetExtension(state) {
  if (testExtension(state.ext)) {
    return state.ext;
  }

  /* Try to guess a possible extension with the filename */
  let ext = path.extname(state.name);
  if (ext) {
    ext = ext.substring(1).toLowerCase();
    if (testExtension(ext)) {
      return ext;
    }
  }

  /* Try to guess a possible extension with the mimetype */
  if (state.mime) {
    const subtype = state.mime.split('/')[1].toLowerCase();
    if (testExtension(subtype)) {
      return subtype;
    }
  }

  return;
}

class ChestObjectLogic extends Elf.Archetype {
  static db = 'chest';
  static indices = ['id', 'name', 'generation'];
  state = new ChestObjectState({
    id: undefined,
    meta: {
      index: '',
      status: 'published',
    },
    name: undefined,
    ext: undefined,
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
    filePath = sanitizeName(filePath);

    state.name = filePath;
    state.ext = tryGetExtension(state);
    state.meta.index = state.name;
  }

  upsert(size, mime, charset, cipher, compress, key, generation) {
    const {state} = this;
    if (size) {
      state.size = size;
    }
    if (mime) {
      state.mime = mime;
    }
    if (charset) {
      state.charset = charset;
    }
    if (cipher && key) {
      state.encryption = {cipher, compress, key};
    }
    state.generation = generation;
    state.ext = tryGetExtension(state);
    state.meta.status = 'published';
  }

  setMetadata(metadata) {
    const {state} = this;
    state.metadata = metadata;
  }

  unlink() {
    const {state} = this;
    state.link = 'unlinked';
  }

  trash() {
    const {state} = this;
    state.meta.status = 'trashed';
  }

  setVectors(vectors) {
    const {state} = this;
    state.meta.vectors = vectors;
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
    const objects = await this.cryo.reader(ChestObjectLogic.db);
    let generation =
      objects
        .queryArchetype('chestObject', ChestObjectShape)
        .field('generation')
        .orderBy((object, $) => $.desc(object.get('generation')))
        .limit(1)
        .get() || 0;
    generation++;

    this.logic.upsert(size, mime, charset, cipher, compress, key, generation);
    await this.persist();
  }

  /**
   * Set optional metadata
   * @param {t<MetadataShape>} metadata
   */
  async setMetadata(metadata) {
    this.logic.setMetadata(metadata);
    await this.persist();
  }

  async setAlias(namespace, name) {
    const feedId = await this.newQuestFeed();

    const id = `chestAlias@${namespace}@${this.id}`;
    const alias = await new ChestAlias(this).create(id, feedId, name);
    await alias.upsert(name);
    return id;
  }

  async setVectors(vectors) {
    this.logic.setVectors(vectors);
    await this.persist();
  }

  async unlink() {
    this.logic.unlink();
    await this.persist();
  }

  async trash() {
    const objects = await this.cryo.reader(ChestObjectLogic.db);
    const aliasIds = objects
      .queryArchetype('chestAlias', ChestAliasShape)
      .field('id')
      .where((alias) => alias.get('id').glob(`*@${this.id}`))
      .all();

    /* Remove alias if any */
    if (aliasIds.length) {
      const feedId = await this.newQuestFeed();

      for (const aliasId of aliasIds) {
        const alias = await new ChestAlias(this).create(aliasId, feedId);
        await alias.trash();
      }
    }

    this.logic.trash();
    await this.persist();
  }

  delete() {}
}

module.exports = {
  ChestObject,
  ChestObjectLogic,
  ChestObjectShape,
  MetadataShape,
};
