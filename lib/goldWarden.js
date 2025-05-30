// @ts-check
const path = require('node:path');
const {Elf} = require('xcraft-core-goblin');
const {string} = require('xcraft-core-stones');
const fse = require('fs-extra');
const chokidar = require('chokidar');
const {Gold, GoldLogic, GoldShape, goldIdFromFile} = require('./gold.js');
const {ChestOptions} = require('./chest.js');
const Git = require('./git/git.js');
const {Chronomancer} = require('goblin-chronomancer');
const {projectPath, appConfigPath, appVersion} = require('xcraft-core-host');
const chestConfig = require('xcraft-core-etc')().load('goblin-chest');

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
  /**
   * @private
   * @type {chokidar.FSWatcher|null}
   */ _watcher;

  /** @private */ _goldPath;
  /** @private */ _namespaces = [];
  /** @private */ _disabled = true;

  /**
   * @param {t<ChestOptions>} [options] Chest's options
   */
  async init(options) {
    await this._reload(options?.goldPath);
  }

  dispose() {
    if (this._watcher) {
      this._watcher.unwatch(this._goldPath);
      this._watcher = null;
    }
  }

  async _gitSync() {
    const {gold} = chestConfig;

    let branch;
    if (process.env.NODE_ENV === 'development') {
      branch = 'master';
    } else {
      branch = appVersion.split('.').slice(0, 2).join('.');
      if (!/^[0-9]+[.][0-9]+$/.test(branch)) {
        throw new Error(`Unsupported branch version ${branch}`);
      }
    }

    const git = new Git(this._goldPath);
    if (fse.existsSync(this._goldPath)) {
      if (!fse.existsSync(path.join(this._goldPath, '.git'))) {
        throw new Error(`${this._goldPath} seems not to be a Git repository`);
      }
      await git.checkout(branch);
      await git.pull();
    } else {
      await git.clone(gold.git.remote, branch);
    }
  }

  /**
   * @param {string|null|undefined} [goldPath]
   */
  async _reload(goldPath = null) {
    const {gold} = chestConfig;

    const chronomancer = new Chronomancer(this);
    await chronomancer.stop('goldWardenGit');

    if (goldPath) {
      this._goldPath = goldPath;
    }

    if (!this._goldPath && process.env.NODE_ENV === 'development') {
      this._goldPath = path.join(projectPath, 'share');
    }

    if (!this._goldPath && gold.git.remote && Git.available) {
      this._goldPath = path.join(appConfigPath, 'var/share');
      const {time} = gold.git;
      if (time) {
        await chronomancer.upsert('goldWardenGit', time, 'goldWarden._gitSync');
        await chronomancer.restart('goldWardenGit', true);
      } else {
        /* Just one time */
        await this._gitSync();
      }
    }

    if (!this._goldPath || !fse.existsSync(this._goldPath)) {
      this.log.warn(`The gold warden is disabled`);
      return;
    }

    this._disabled = false;
    this._namespaces = gold.namespaces;

    let isReady = false;
    const initials = [];
    const reader = await this.cryo.reader(GoldLogic.db);

    if (this._watcher) {
      await this._watcher.close();
    }

    this._watcher = chokidar
      .watch(this._goldPath, {
        cwd: this._goldPath,
        followSymlinks: false,
        awaitWriteFinish: true,
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
        await this._provide(goldId, file);
      })
      .on('change', async (file) => {
        const goldId = goldIdFromFile(file);
        if (!isReady) {
          initials.push(goldId);
        }
        await this._provide(goldId, file);
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

  async repository() {
    return !this._disabled ? this._goldPath : null;
  }

  async setGoldPath(goldPath) {
    if (!goldPath) {
      goldPath = null;
    }
    if (this._goldPath && goldPath !== this._goldPath && this._watcher) {
      this._watcher.unwatch(this._goldPath);
    }
    await this._reload(goldPath);
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

  async _provide(goldId, file) {
    const feedId = await this.newQuestFeed();
    const gold = await new Gold(this).create(goldId, feedId);
    await gold.provide(path.join(this._goldPath, file));
  }
}

module.exports = {GoldWarden, GoldWardenLogic};
