// @ts-check
'use strict';

const path = require('node:path');
const {setTimeout: setTimeoutAsync} = require('node:timers/promises');
const {expect} = require('chai');
const {Elf} = require('xcraft-core-goblin/lib/test.js');
const {GoldWarden} = require('../lib/goldWarden.js');
const {GoldLogic, GoldShape} = require('../lib/gold.js');

describe('goblin.chest.goldWarden', function () {
  let runner;
  const goldPath = path.join(__dirname, 'share');

  this.beforeAll(function () {
    const fse = require('fs-extra');
    const {appConfigPath} = require('xcraft-core-host');
    if (appConfigPath.endsWith('-test')) {
      fse.removeSync(appConfigPath);
    }

    runner = new Elf.Runner();
    runner.init();
  });

  this.afterAll(function () {
    runner.dispose();
  });

  it('init', async function () {
    this.timeout(process.env.NODE_ENV === 'development' ? 1000000 : 10000);
    await runner.it(async function () {
      const goldWarden = new GoldWarden(this);
      await goldWarden.init({goldPath});

      await setTimeoutAsync(1000);

      const reader = await this.cryo.reader(GoldLogic.db);
      const golds = reader.queryArchetype('gold', GoldShape).field('id').all();

      expect(golds.length).length.to.be.equals(2);
      expect(golds).includes('gold@workflows@test%2Dworkflow@index%2Ejs');
      expect(golds).includes('gold@workflows@test%2Dworkflow@workflow%2Ejson');
    });
  });
});
