const {Elf} = require('xcraft-core-goblin');
const {Chest, ChestLogic} = require('./lib/service.js');

exports.xcraftCommands = Elf.birth(Chest, ChestLogic);
