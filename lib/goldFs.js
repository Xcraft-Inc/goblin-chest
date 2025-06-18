// @ts-check
'usr strict';

const path = require('node:path');
const {Dirent} = require('node:fs');
const fse = require('fs-extra');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {
  Gold,
  GoldLogic,
  GoldShape,
  fileFromGoldId,
  goldIdFromFile,
} = require('./gold.js');

class GoldFs {
  /**
   * @type {Elf}
   */
  #elf;

  constructor(elf) {
    this.#elf = elf;
  }

  async #readdir(location, options) {
    const paths = location.split(path.sep);
    const elements = paths.map(SmartId.encode).join('@');
    const reader = await this.#elf.cryo.reader(GoldLogic.db);
    return reader
      .queryArchetype('gold', GoldShape)
      .field('id')
      .where((gold) => gold.get('id').glob(`gold@${elements}@*`))
      .all()
      .map(fileFromGoldId)
      .reduce((list, file) => {
        const entries = file.split(path.sep);
        const name = entries[paths.length];
        if (
          list.some((entry) =>
            options?.withFileTypes ? entry.name : entry === name
          )
        ) {
          return list;
        }
        if (!options?.withFileTypes) {
          list.push(name);
          return list;
        }
        const dirent = new Dirent();
        dirent.name = name;
        dirent.parentPath = location;
        dirent.isDirectory = () => entries.length > 2;
        list.push(dirent);
        return list;
      }, []);
  }

  /**
   * @param {string} location
   * @returns {Promise<string[]>}
   */
  async readdir(location) {
    return this.#readdir(location, {withFileTypes: false});
  }

  /**
   * @param {string} location
   * @returns {Promise<Dirent[]>}
   */
  async readdirent(location) {
    return this.#readdir(location, {withFileTypes: true});
  }

  async readFile(location, options) {
    const goldId = goldIdFromFile(location);
    const feedId = await this.#elf.newQuestFeed();
    const gold = await new Gold(this.#elf).create(goldId, feedId);
    location = await gold.retrieve();
    return location ? await fse.readFile(location, options) : null;
  }

  async readJSON(location, options) {
    const goldId = goldIdFromFile(location);
    const feedId = await this.#elf.newQuestFeed();
    const gold = await new Gold(this.#elf).create(goldId, feedId);
    location = await gold.retrieve();
    return location ? await fse.readJSON(location, options) : null;
  }

  async writeJSON(location, object, options = {replacer: null, spaces: 2}) {
    const goldId = goldIdFromFile(location);
    const feedId = await this.#elf.newQuestFeed();
    const gold = await new Gold(this.#elf).create(goldId, feedId);
    await gold.update(JSON.stringify(object, options.replacer, options.spaces));
  }

  async exists(location) {
    const goldId = goldIdFromFile(location);
    return await GoldLogic.exist(this.#elf.cryo, goldId);
  }

  async resolve(location) {
    const goldId = goldIdFromFile(location);
    const feedId = await this.#elf.newQuestFeed();
    const gold = await new Gold(this.#elf).create(goldId, feedId);
    return await gold.retrieve();
  }
}

module.exports = GoldFs;
