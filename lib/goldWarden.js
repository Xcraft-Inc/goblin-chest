// @ts-check
const path = require('node:path');
const {Elf, SmartId} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const {Gold, GoldLogic, GoldShape} = require('./gold.js');

class GoldWardenShape {
  id = string;
}

class GoldWardenState extends Elf.Sculpt(GoldWardenShape) {}

class GoldWardenLogic extends Elf.Spirit {
  state = new GoldWardenState({
    id: 'goldWarden',
  });
}

function goldIdFromFile(file) {
  const items = file.split(path.sep);
  return SmartId.from('gold', items.map(SmartId.encode).join('@'), false);
}

class GoldWarden extends Elf.Alone {
  _disabled = true;
  _watcher;
  _goldPath;
  _namespaces = [];

  async init() {
    // TODO: only in dev., add support for production with Git
    if (process.env.NODE_ENV === 'development') {
      const {projectPath} = require('xcraft-core-host');
      this._goldPath = path.join(projectPath, 'share');
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
    await gold.update(path.join(this._goldPath, file));
  }
}

module.exports = {GoldWarden, GoldWardenLogic};
