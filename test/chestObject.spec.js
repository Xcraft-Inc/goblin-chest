'use strict';

const {expect} = require('chai');
const {Elf} = require('xcraft-core-goblin/lib/test.js');

describe('goblin.chest.chestObject', function () {
  const {ChestObjectLogic} = require('../lib/chestObject.js');

  it('create', function () {
    const objectLogic = Elf.trial(ChestObjectLogic);

    objectLogic.create('chestObject@test', '/home/yeti/foobar.obj');
    expect(objectLogic.state.name).to.be.equal('foobar.obj');
    expect(objectLogic.state.link).to.be.equal('linked');
  });

  it('upsert', function () {
    const objectLogic = Elf.trial(ChestObjectLogic);

    objectLogic.create('chestObject@test', '/home/yeti/foobar.obj');
    objectLogic.upsert(42, 'image/png', 'binary', null, null, null, 1);
    expect(objectLogic.state.size).to.be.equal(42);
    expect(objectLogic.state.generation).to.be.equal(1);
    expect(objectLogic.state.meta.status).to.be.equal('published');

    objectLogic.upsert(42, 'image/png', 'binary', 'aes-256', null, null, 1);
    expect(objectLogic.state.encryption).to.be.equal(undefined);

    objectLogic.upsert(42, 'image/png', 'binary', null, null, 'key', 1);
    expect(objectLogic.state.encryption).to.be.equal(undefined);

    objectLogic.upsert(42, 'image/png', 'binary', 'aes-256', null, 'key', 1);
    expect(objectLogic.state.encryption.toJS()).to.deep.equal({
      cipher: 'aes-256',
      compress: null,
      key: 'key',
    });
  });

  it('unlink', function () {
    const objectLogic = Elf.trial(ChestObjectLogic);

    objectLogic.create('chestObject@test', '/home/yeti/foobar.obj');
    expect(objectLogic.state.link).to.be.equal('linked');

    objectLogic.unlink();
    expect(objectLogic.state.link).to.be.equal('unlinked');
  });

  it('trash', function () {
    const objectLogic = Elf.trial(ChestObjectLogic);

    objectLogic.create('chestObject@test', '/home/yeti/foobar.obj');
    objectLogic.trash();
    expect(objectLogic.state.meta.status).to.be.equal('trashed');
  });
});
