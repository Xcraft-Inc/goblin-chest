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
const locks = require('xcraft-core-utils/lib/locks.js');
const {projectPath, appConfigPath, appVersion} = require('xcraft-core-host');
const debounce = require('lodash/debounce.js');
const chestConfig = require('xcraft-core-etc')().load('goblin-chest');
const goblinConfig = require('xcraft-core-etc')().load('xcraft-core-goblin');

class GoldWardenShape {
  id = string;
}

class GoldWardenState extends Elf.Sculpt(GoldWardenShape) {}

class GoldWardenLogic extends Elf.Spirit {
  state = new GoldWardenState({
    id: 'goldWarden',
  });
}

/**
 * @param {Git} git
 * @param {Map<string,"add"|"rm">|null} staging
 * @returns {Promise<boolean>}
 */
const stageFiles = async (git, staging) => {
  if (!staging) {
    return false;
  }
  const add = [];
  const rm = [];
  Array.from(staging.entries()).forEach(([filePath, action]) => {
    if (action === 'add') {
      add.push(filePath);
    } else if (action === 'rm') {
      rm.push(filePath);
    }
  });
  if (add.length) {
    await git.add(...add);
  }
  if (rm.length) {
    await git.rm(...rm);
  }
  return add.length + rm.length === 0 ? false : await git.staged();
};

class GoldWarden extends Elf.Alone {
  /**
   * @private
   * @type {chokidar.FSWatcher|null}
   */ _watcher;

  /** @private */ _goldPath;
  /** @private */ _gitRemote;
  /** @private */ _namespaces = [];
  /** @private */ _disabled = true;

  /**
   * @private
   * @type {Map<string,"add"|"rm">|null}
   */ _staging;

  /** @private */ _gitSyncDebouned = debounce(this._gitSync, 1000);

  /**
   * @param {t<ChestOptions>} [options] Chest's options
   */
  async init(options) {
    await this._reload(options?.goldPath, options?.gitRemote);
  }

  dispose() {
    if (this._watcher) {
      this._watcher.unwatch(this._goldPath);
      this._watcher = null;
    }
  }

  async _gitSync() {
    const gitLock = locks.getMutex;
    await gitLock.lock(`goldWarden-git-sync`);
    this.quest.defer(() => gitLock.unlock(`goldWarden-git-sync`));

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

    if (!(await fse.pathExists(this._goldPath))) {
      await git.clone(this._gitRemote, branch);
      return;
    }

    if (!(await fse.pathExists(path.join(this._goldPath, '.git')))) {
      throw new Error(`${this._goldPath} seems not to be a Git repository`);
    }

    await git.reset(); /* Use a clean working dir */
    await git.checkout(branch);
    await git.pull();
    if (!(await stageFiles(git, this._staging))) {
      return; /* Nothing staged, get out */
    }

    await git.commit();
    if (process.env.NODE_ENV !== 'development') {
      await git.push();
    }
  }

  /**
   * @param {string|null|undefined} [goldPath]
   * @param {string|null|undefined} [gitRemote]
   */
  async _reload(goldPath = null, gitRemote = null) {
    const {gold} = chestConfig;

    const chronomancer = new Chronomancer(this);
    await chronomancer.stop('goldWardenGit');

    if (this._staging) {
      this._staging.clear();
      this._staging = null;
    }

    if (goldPath) {
      this._goldPath = goldPath;
    }
    this._gitRemote = gitRemote ? gitRemote : gold.git.remote;

    const isClient = goblinConfig.actionsSync?.enable;
    if (
      !this._goldPath &&
      !isClient &&
      process.env.NODE_ENV === 'development'
    ) {
      this._goldPath = path.join(projectPath, 'share');
    }

    if (!this._goldPath && this._gitRemote && Git.available) {
      this._goldPath = path.join(appConfigPath, 'var/share');
      this._staging = new Map();

      const {time} = gold.git;
      if (time) {
        await chronomancer.upsert('goldWardenGit', time, 'goldWarden._gitSync');
        await chronomancer.restart('goldWardenGit', true);
      } else {
        /* Just one time */
        await this._gitSync();
      }
    }

    if (!this._goldPath || !(await fse.pathExists(this._goldPath))) {
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
      this._watcher = null;
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
        const filePath = path.join(this._goldPath, file);
        await this._provide(goldId, filePath);
      })
      .on('change', async (file) => {
        const goldId = goldIdFromFile(file);
        if (!isReady) {
          initials.push(goldId);
        }
        const filePath = path.join(this._goldPath, file);
        await this._provide(goldId, filePath);
      })
      .on('unlink', async (file) => {
        const goldId = goldIdFromFile(file);
        const filePath = path.join(this._goldPath, file);
        await this._trash(goldId, filePath);
      })
      .on('ready', async () => {
        isReady = true;
        const golds = reader
          .queryArchetype('gold', GoldShape)
          .field('id')
          .where((gold, $) => $.not($.in(gold.get('id'), initials)))
          .all();
        initials.length = 0;
        await this._trashGolds(golds); /* Trash golds of deleted files */
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

  async setGitRemote(gitRemote) {
    if (!gitRemote) {
      gitRemote = null;
    }
    if (this._goldPath && gitRemote !== this._gitRemote && this._watcher) {
      this._watcher.unwatch(this._goldPath);
    }
    await this._reload(null, gitRemote);
  }

  async _trashGolds(golds) {
    if (!golds.length) {
      return;
    }

    const feedId = await this.newQuestFeed();
    for (const goldId of golds) {
      const gold = await new Gold(this).create(goldId, feedId);
      await gold.trash();
    }
  }

  async _trash(goldId, filePath) {
    const feedId = await this.newQuestFeed();
    const gold = await new Gold(this).create(goldId, feedId);
    await gold.trash();
    if (this._staging) {
      this._staging.set(filePath, 'rm');
      await this._gitSyncDebouned();
    }
  }

  async _provide(goldId, filePath) {
    const feedId = await this.newQuestFeed();
    const gold = await new Gold(this).create(goldId, feedId);
    await gold.provide(filePath);
    if (this._staging) {
      this._staging.set(filePath, 'add');
      await this._gitSyncDebouned();
    }
  }
}

module.exports = {GoldWarden, GoldWardenLogic};
