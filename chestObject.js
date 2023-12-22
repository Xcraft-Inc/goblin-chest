const {Elf} = require('xcraft-core-goblin');
const {ChestObject, ChestObjectLogic} = require('./lib/chestObject.js');

exports.xcraftCommands = Elf.birth(ChestObject, ChestObjectLogic);
