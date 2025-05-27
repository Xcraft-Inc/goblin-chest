const {Elf} = require('xcraft-core-goblin');
const {GoldWarden, GoldWardenLogic} = require('./lib/goldWarden.js');

exports.xcraftCommands = Elf.birth(GoldWarden, GoldWardenLogic);
