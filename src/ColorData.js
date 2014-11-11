var Q = require('q')

var ColorValue = require('./ColorValue')
var verify = require('./verify')

/**
 * @class ColorData
 *
 * @param {ColorDataStorage} storage
 */
function ColorData(storage) {
  verify.ColorDataStorage(storage)

  this._storage = storage
}

/**
 * Return ColorValue currently present in ColorDataStorage
 *
 * @param {string} txId
 * @param {number} outIndex
 * @param {ColorDefinition} colorDefinition
 * @return {?ColorValue}
 */
ColorData.prototype.fetchColorValue = function(txId, outIndex, colorDefinition) {
  verify.txId(txId)
  verify.number(outIndex)
  verify.ColorDefinition(colorDefinition)

  var colorData = this._storage.get({
    colorId: colorDefinition.getColorId(),
    txId: txId,
    outIndex: outIndex
  })
  if (colorData === null)
    return null

  return new ColorValue(colorDefinition, colorData.value)
}

/**
 * @callback ColorData~scanTx
 * @param {?Error} error
 */

/**
 * Scan transaction to obtain color data for its outputs
 *
 * @param {Transaction} tx
 * @param {?number[]} outputIndices
 * @param {ColorDefinition} colorDefinition
 * @param {function} getTxFn
 * @param {ColorData~scanTx} cb Called on finished with params (error)
 */
ColorData.prototype.scanTx = function(tx, outputIndices, colorDefinition, getTxFn, cb) {
  verify.Transaction(tx)

  if (outputIndices !== null) {
    verify.array(outputIndices)
    outputIndices.forEach(verify.number)
  }
  verify.ColorDefinition(colorDefinition)
  verify.function(cb)

  var self = this

  Q.fcall(function() {
    var inColorValues = []
    var empty = true

    tx.ins.forEach(function(input) {
      var colorData = self._storage.get({
        colorId: colorDefinition.getColorId(),
        txId: Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex'),
        outIndex: input.index
      })

      var colorValue = null
      if (colorData !== null) {
        empty = false
        colorValue = new ColorValue(colorDefinition, colorData.value)
      }
      inColorValues.push(colorValue)
    })

    if (!(empty && !colorDefinition.isSpecialTx(tx)))
      return Q.ninvoke(colorDefinition, 'runKernel', tx, inColorValues, getTxFn)
             .then(function(outColorValues) {
               var asTransaction = !!(self._storage && self._storage._eventuallySave),
                   added = false;
               outColorValues.forEach(function(colorValue, index) {
                 var skipAdd = colorValue === null ||
                   (outputIndices !== null && outputIndices.indexOf(index) === -1)

                 if (!skipAdd) {
                   added = true;
                   self._storage.add({
                     colorId: colorDefinition.getColorId(),
                     txId: tx.getId(),
                     outIndex: index,
                     value: colorValue.getValue()
                   }, asTransaction)
                 }
               })
               if (asTransaction && added)
                 self._storage._eventuallySave()
             })
  }).done(function(){ cb(null) }, function(error) { cb(error) })
}

/**
 * @callback ColorData~getColorValue
 * @param {?Error} error
 * @param {?ColorValue} colorValue
 */

/**
 * For a given txId, outIndex and colorDefinition return ColorValue or null if
 *  colorDefinition not represented in given txOut
 *
 * @param {string} txId
 * @param {number} outIndex
 * @param {ColorDefinition} colorDefinition
 * @param {function} getTxFn
 * @param {ColorData~getColorValue} cb
 */
ColorData.prototype.getColorValue = function(txId, outIndex, colorDefinition, getTxFn, cb) {
  verify.txId(txId)
  verify.number(outIndex)
  verify.ColorDefinition(colorDefinition)
  verify.function(getTxFn)
  verify.function(cb)

  var self = this

  Q.fcall(function() {
    var scannedOutputs = []

    function processOne(txId, outIndex) {
      if (scannedOutputs.indexOf(txId + outIndex) !== -1)
        return

      scannedOutputs.push(txId + outIndex)

      var colorValue = self.fetchColorValue(txId, outIndex, colorDefinition)
      if (colorValue !== null)
        return

      function processTx(tx) {
        return Q.nfcall(colorDefinition.constructor.getAffectingInputs, tx, [outIndex], getTxFn)
          .then(function(inputs) {
            var promise = Q()

            inputs.forEach(function(input) {
              var txId = Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex')
              promise = promise.then(function() {
                return Q.fcall(processOne, txId, input.index)
              })
            })

            promise = promise.then(function() {
              return Q.ninvoke(self, 'scanTx', tx, null, colorDefinition, getTxFn)

            })

            return promise
          })
      }

      return Q.nfcall(getTxFn, txId).then(processTx)
    }

    return Q.fcall(processOne, txId, outIndex)

  }).then(function() {
    return self.fetchColorValue(txId, outIndex, colorDefinition)

  }).done(function(colorValue) { cb(null, colorValue) }, function(error) { cb(error) })
}

/**
 * @callback ColorData~getColorValuesForTx
 * @param {?Error} error
 * @param {?ColorValue[]} colorValues
 */

/**
 * @param {bitcoinjs-lib.Transaction} tx
 * @param {ColorDefinition} colorDefinition
 * @param {function} getTxFn
 * @param {ColorData~getColorValuesForTx} cb
 */
ColorData.prototype.getColorValuesForTx = function(tx, colorDefinition, getTxFn, cb) {
  verify.Transaction(tx)
  verify.ColorDefinition(colorDefinition)
  verify.function(getTxFn)
  verify.function(cb)

  var self = this

  var inColorValuesPromises = tx.ins.map(function(input) {
    var txId = Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex')
    return Q.ninvoke(self, 'getColorValue', txId, input.index, colorDefinition, getTxFn)
  })

  Q.all(inColorValuesPromises).then(function(inColorValues) {
    return Q.ninvoke(colorDefinition, 'runKernel', tx, inColorValues, getTxFn)

  }).done(function(outColorValues) { cb(null, outColorValues) }, function(error) { cb(error) })
}

/**
 * @param {string} txId
 * @param {number} outIndex
 */
ColorData.prototype.removeColorValues = function(txId, outIndex) {
  verify.txId(txId)
  verify.number(outIndex)

  return this._storage.remove({ txId: txId, outIndex: outIndex })
}


module.exports = ColorData
