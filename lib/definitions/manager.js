/* globals Promise:true */
var Promise = require('bluebird')

var GenesisColorDefinition = require('./genesis')
var UncoloredColorDefinition = require('./uncolored')
var errors = require('../errors')

/**
 * @class ColorDefinitionManager
 * @param {IColorDefinitionStorage} storage
 */
function ColorDefinitionManager (storage) {
  this._storage = storage
  this._uncolored = new UncoloredColorDefinition()
}

ColorDefinitionManager._cd_classes = {}

/**
 * @return {UncoloredColorDefinition}
 */
ColorDefinitionManager.getUncolored = function () {
  return new UncoloredColorDefinition()
}

/**
 * @return {GenesisColorDefinition}
 */
ColorDefinitionManager.getGenesis = function () {
  return new GenesisColorDefinition()
}

/**
 * @param {ColorDefinition} cls
 * @throws {ColorDefinitionAlreadyRegisteredError}
 */
ColorDefinitionManager.registerColorDefinition = function (cls) {
  if (ColorDefinitionManager._cd_classes[cls.code] !== undefined) {
    var msg = cls.code + ': ' + cls.name
    throw new errors.ColorDefinitionAlreadyRegisteredError(msg)
  }

  ColorDefinitionManager._cd_classes[cls.code] = cls
}

/**
 * @param {string} code
 * @return {?function}
 */
ColorDefinitionManager.getColorDefenitionClsForCode = function (code) {
  return ColorDefinitionManager._cd_classes[code] || null
}

/**
 * @private
 * @param {IColorDefinitionStorage~Record} record
 * @return {?ColorDefinition}
 */
ColorDefinitionManager.prototype._record2ColorDefinition = function (record) {
  var code = record.desc.split(':')[0]
  var Cls = ColorDefinitionManager.getColorDefenitionClsForCode(code)

  try {
    return Cls.fromDesc(record.id, record.desc)
  } catch (err) {}

  return null
}

/**
 * Return ColorDefinition instance if desc in store.
 *  Otherwise if autoAdd is true creates new ColorDefinition, add to store
 *    and return it
 *
 * @param {string} desc
 * @param {Object} [opts]
 * @param {boolean} [opts.autoAdd=true]
 * @return {Promise.<?ColorDefinition>}
 */
ColorDefinitionManager.prototype.resolve = function (desc, opts) {
  var self = this
  return Promise.try(function () {
    if (self._uncolored.desc === desc) {
      return ColorDefinitionManager.getUncolored()
    }

    var colordef = self._record2ColorDefinition({id: -1, desc: desc})
    if (colordef === null) {
      throw new errors.ColorDefinitionBadDescError(desc)
    }

    return self._storage.resolve(desc, opts)
      .then(function (record) {
        return record === null
          ? null
          : self._record2ColorDefinition(record)
      })
  })
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.id]
 * @return {Promise.<(?ColorDefinition|ColorDefinition[])>}
 */
ColorDefinitionManager.prototype.get = function (opts) {
  var self = this
  var id = Object(opts).id
  if (id === undefined) {
    return self._storage.get()
      .then(function (records) {
        return records.map(function (record) {
          return self._record2ColorDefinition(record)
        })
      })
  }

  return self._storage.get({id: id})
    .then(function (record) {
      if (record !== null) {
        return self._record2ColorDefinition(record)
      }

      if (self._uncolored.colorId === id) {
        return ColorDefinitionManager.getUncolored()
      }

      return null
    })
}

module.exports = ColorDefinitionManager