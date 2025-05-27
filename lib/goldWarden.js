// @ts-check
const path = require('node:path');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const {Gold, GoldLogic, GoldShape, goldIdFromFile} = require('./gold.js');

class GoldWardenShape {
  id = string;
}

class GoldWardenState extends Elf.Sculpt(GoldWardenShape) {}

class GoldWardenLogic extends Elf.Spirit {
  state = new GoldWardenState({
    id: 'goldWarden',
  });
}

class GoldWarden extends Elf.Alone {
  /** @private */ _watcher;
  /** @private */ _goldPath;
  /** @private */ _namespaces = [];
  /** @private */ _disabled = true;

  async init() {
    if (process.env.NODE_ENV === 'development') {
      const {projectPath} = require('xcraft-core-host');
      this._goldPath = path.join(projectPath, 'share');
    }

    // TODO: add support for production with Git (client and server)
    if (!this._goldPath) {
      // TODO: if client, test if share repository support is enabled
      // TODO: detect if Git is available, if yes, clone the share repository
    }

    if (!this._goldPath || !fse.existsSync(this._goldPath)) {
      this.log.warn(`The gold warden is disabled`);
      return;
    }

    this._disabled = false;

    const chestConfig = require('xcraft-core-etc')().load('goblin-chest');
    this._namespaces = chestConfig.gold.namespaces;

    let isReady = false;
    const initials = [];
    const reader = await this.cryo.reader(GoldLogic.db);

    const chokidar = require('chokidar');
    this._watcher = chokidar
      .watch(this._goldPath, {
        cwd: this._goldPath,
        /* Ignore files which are not in known namespaces */
        ignored: (file, st) => {
          file = path.relative(this._goldPath, file);
          if (!file) {
            return false;
          }
          const namespace = file.split(path.sep)[0];
          return !this._namespaces.includes(namespace);
        },
      })
      .on('add', async (file) => {
        const goldId = goldIdFromFile(file);
        if (!isReady) {
          initials.push(goldId);
        }
        await this._update(goldId, file);
      })
      .on('change', async (file) => {
        const goldId = goldIdFromFile(file);
        if (!isReady) {
          initials.push(goldId);
        }
        await this._update(goldId, file);
      })
      .on('unlink', async (file) => {
        const golds = [goldIdFromFile(file)];
        await this._trash(golds);
      })
      .on('ready', async () => {
        isReady = true;
        const golds = reader
          .queryArchetype('gold', GoldShape)
          .field('id')
          .where((gold, $) => $.not($.in(gold.get('id'), initials)))
          .all();
        initials.length = 0;
        await this._trash(golds); /* Trash golds of deleted files */
      });
  }

  dispose() {
    if (this._watcher) {
      this._watcher.unwatch(this._goldPath);
      this._watcher = null;
    }
  }

  async repository() {
    return !this._disabled ? this._goldPath : null;
  }

  async _trash(golds) {
    if (!golds.length) {
      return;
    }

    const feedId = await this.newQuestFeed();
    for (const goldId of golds) {
      const gold = await new Gold(this).create(goldId, feedId);
      await gold.trash();
    }
  }

  async _update(goldId, file) {
    const feedId = await this.newQuestFeed();
    const gold = await new Gold(this).create(goldId, feedId);
    await gold.provide(path.join(this._goldPath, file));
  }
}

module.exports = {GoldWarden, GoldWardenLogic};
