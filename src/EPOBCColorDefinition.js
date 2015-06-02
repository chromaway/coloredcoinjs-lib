var inherits = require('util').inherits

var _ = require('lodash')
var Q = require('q')

var ColorDefinition = require('./ColorDefinition')
var ColorDefinitionManager = require('./ColorDefinitionManager')
var GenesisColorDefinition = require('./GenesisColorDefinition')
var UncoloredColorDefinition = require('./UncoloredColorDefinition')
var ColorValue = require('./ColorValue')
var ColorTarget = require('./ColorTarget')
var errors = require('./errors')
var util = require('./util')
var verify = require('./verify')


/**
 * @private
 * @class Tag
 * @param {number} paddingCode
 * @param {boolean} isGenesis
 */
function Tag(paddingCode, isGenesis) {
  verify.number(paddingCode)
  verify.boolean(isGenesis)

  this.paddingCode = paddingCode
  this.isGenesis = isGenesis
}

Tag.xferTagBits = [1, 1, 0, 0, 1, 1]
Tag.genesisTagBits = [1, 0, 1, 0, 0, 1]


/**
 * Calculate paddingCode from minPadding
 *
 * @param {number} minPadding
 * @return {number}
 * @throws {EPOBCPaddingError}
 */
Tag.closestPaddingCode = function (minPadding) {
  verify.number(minPadding)

  if (minPadding <= 0) { return 0 }

  var paddingCode = 1
  while (Math.pow(2, paddingCode) < minPadding && paddingCode <= 63) {
    paddingCode += 1
  }

  if (paddingCode > 63) {
    throw new errors.EPOBCPaddingError('Required ' + minPadding + ', otherwise max ' + Math.pow(2, 63))
  }

  return paddingCode
}


/**
 * @param {external:bitcoinjs-lib.Transaction} tx
 * @return {?Tag} Tag instance if tx is genesis or xfer and not coinbase
 */
Tag.fromTx = function (tx) {
  verify.Transaction(tx)

  var isCoinbase = (
    tx.ins[0].hash.toString('hex') === '0000000000000000000000000000000000000000000000000000000000000000' &&
    tx.ins[0].index === 4294967295)
  if (isCoinbase) { return null }

  return Tag.fromSequence(tx.ins[0].sequence)
}

/**
 * Create new Tag from sequence
 * @param {number} sequence
 * @return {?Tag}
 */
Tag.fromSequence = function (sequence) {
  verify.number(sequence)

  var bits = util.number2bitArray(sequence)
  var tagBits = bits.slice(0, 6)

  var isXfer = Tag.xferTagBits.every(function (v, i) { return v === tagBits[i] })
  var isGenesis = Tag.genesisTagBits.every(function (v, i) { return v === tagBits[i] })

  if (!(isXfer || isGenesis)) { return null }

  var paddingCode = util.bitArray2number(bits.slice(6, 12))
  return new Tag(paddingCode, isGenesis)
}

/**
 * @return {number}
 */
Tag.prototype.toSequence = function () {
  var bits = Array.prototype.concat(
    this.isGenesis ? Tag.genesisTagBits : Tag.xferTagBits,
    util.number2bitArray(this.paddingCode, 6),
    Array.apply(null, new Array(20)).map(function () { return 0 })
  )

  return util.bitArray2number(bits)
}

/**
 * @return {number}
 */
Tag.prototype.getPadding = function () {
  if (this.paddingCode === 0) { return 0 }

  return Math.pow(2, this.paddingCode)
}


/**
 * Returns a Array of indices that correspond to the inputs
 *  for an output in the transaction tx with output index outIndex
 *  which has a padding of padding (2^n for some n>0 or 0)
 *
 * @private
 * @param {external:bitcoinjs-lib.Transaction} tx
 * @param {number} padding
 * @param {number} outIndex
 * @return {number[]}
 */
function getXferAffectingInputs(tx, padding, outIndex) {
  verify.Transaction(tx)
  verify.number(padding)
  verify.number(outIndex)

  var valueWop
  var outValueWop
  var outPrecSum = 0

  for (var oi = 0; oi < outIndex; ++oi) {
    valueWop = tx.outs[oi].value - padding
    if (valueWop <= 0) { return [] }

    outPrecSum += valueWop
  }

  outValueWop = tx.outs[outIndex].value - padding
  if (outValueWop <= 0) { return [] }

  var affectingInputs = []
  var inputRunningSum = 0

  for (var ii = 0; ii < tx.ins.length; ++ii) {
    var prevTag = Tag.fromTx(tx.ins[ii].prevTx)
    if (prevTag === null) { break }

    valueWop = tx.ins[ii].value - prevTag.getPadding()
    if (valueWop <= 0) { break }

    var isAffectingInput = (
      inputRunningSum < (outPrecSum + outValueWop) &&
      (inputRunningSum + valueWop) > outPrecSum)

    if (isAffectingInput) { affectingInputs.push(ii) }

    inputRunningSum += valueWop
  }
  // check if output is completely filled
  if (inputRunningSum < outPrecSum + outValueWop) { return [] }

  return affectingInputs
}


/**
 * @class EPOBCColorDefinition
 * @extends ColorDefinition
 *
 * @param {number} colorId
 * @param {Object} genesis
 * @param {string} genesis.txId
 * @param {number} genesis.outIndex
 * @param {number} genesis.height
 */
function EPOBCColorDefinition(colorId, genesis) {
  ColorDefinition.call(this, colorId)

  verify.object(genesis)
  verify.txId(genesis.txId)
  verify.number(genesis.outIndex)
  verify.number(genesis.height)

  this.genesis = genesis
}

inherits(EPOBCColorDefinition, ColorDefinition)

/**
 * @return {string}
 */
EPOBCColorDefinition.prototype.getColorType = function () {
  return 'epobc'
}

/**
 * Create EPOBCColorDefinition from colorId and desc
 *
 * @param {number} colorId
 * @param {string} desc
 * @return {EPOBCColorDefinition}
 * @throws {ColorDefinitionBadDescError}
 */
EPOBCColorDefinition.fromDesc = function (colorId, desc) {
  verify.number(colorId)
  verify.string(desc)

  var items = desc.split(':')
  if (items[0] !== 'epobc') {
    throw new errors.ColorDefinitionBadDescError('EPOBC fail load: ' + desc)
  }

  var genesis = {
    txId: items[1],
    outIndex: parseInt(items[2]),
    height: parseInt(items[3])
  }

  return new EPOBCColorDefinition(colorId, genesis)
}

/**
 * Return desc as string described this colorDefinition
 *
 * @return {string}
 */
EPOBCColorDefinition.prototype.getDesc = function () {
  var data = ['epobc', this.genesis.txId, this.genesis.outIndex, this.genesis.height]
  return data.join(':')
}

/**
 * @param {external:bitcoinjs-lib.Transaction} tx
 * @return {boolean}
 */
EPOBCColorDefinition.prototype.isSpecialTx = function (tx) {
  verify.Transaction(tx)

  return tx.getId() === this.genesis.txId
}

/**
 * @callback EPOBCColorDefinition~runKernelCallback
 * @param {?Error} error
 * @param {Array.<?ColorValue>} colorValues
 */

/**
 * Given a transaction tx and the colorValues in a Array colorValueSet,
 *  return the colorValues of the tx.outs in a Array via callback cb
 *
 * @param {Transaction} tx
 * @param {Array.<?ColorValue>} colorValueSet
 * @param {getTxFn} getTxFn
 * @param {EPOBCColorDefinition~runKernelCallback} cb
 */
EPOBCColorDefinition.prototype.runKernel = function (tx, colorValueSet, getTxFn, cb) {
  verify.Transaction(tx)
  verify.array(colorValueSet)
  colorValueSet.filter(function (cv) { return cv !== null }).forEach(verify.ColorValue)
  verify.function(cb)

  var self = this

  Q.fcall(function () {
    var tag = Tag.fromTx(tx)

    if (tag === null || tag.isGenesis) {
      var outColorValues = Array.apply(null, new Array(tx.outs.length)).map(function () { return null })

      if (tag !== null && self.isSpecialTx(tx)) {
        var valueWop = tx.outs[0].value - tag.getPadding()
        if (valueWop > 0) {
          outColorValues[0] = new ColorValue(self, valueWop)
        }
      }

      return outColorValues
    }

    var padding = tag.getPadding()

    return Q.ninvoke(tx, 'ensureInputValues', getTxFn).then(function (tx) {
      var promises = tx.outs.map(function (output, outIndex) {
        var outValueWop = output.value - padding
        if (outValueWop <= 0) { return null }

        var affectingInputs = getXferAffectingInputs(tx, padding, outIndex)
        var allColored = affectingInputs.every(function (ai) {
          return (colorValueSet[ai] !== null && !_.isUndefined(colorValueSet[ai]))
        })

        if (!allColored) { return null }

        var colorValues = [new ColorValue(self, 0)]
        colorValues = colorValues.concat(affectingInputs.map(function (ai) { return colorValueSet[ai] }))

        var totalColorValue = ColorValue.sum(colorValues)
        if (totalColorValue.getValue() < outValueWop) { return null }

        return new ColorValue(self, outValueWop)
      })

      return Q.all(promises)
    })

  }).done(function (colorValues) { cb(null, colorValues) }, function (error) { cb(error) })
}

/**
 * @callback EPOBCColorDefinition~getAffectingInputsCallback
 * @param {?Error} error
 * @param {Object[]} affectingInputs
 */

/**
 * Given transaction tx, outputIndex in a Array as outputSet and
 *  return affecting inputs of transaction tx in a Array via callback cb
 *
 * @param {Transaction} tx
 * @param {number[]} outputSet
 * @param {getTxFn} getTxFn
 * @param {EPOBCColorDefinition~getAffectingInputsCallback} cb
 */
EPOBCColorDefinition.getAffectingInputs = function (tx, outputSet, getTxFn, cb) {
  verify.Transaction(tx)
  verify.array(outputSet)
  outputSet.forEach(verify.number)
  verify.function(getTxFn)
  verify.function(cb)

  Q.fcall(function () {
    var tag = Tag.fromTx(tx)
    if (tag === null || tag.isGenesis) { return [] }

    var padding = tag.getPadding()
    return Q.ninvoke(tx, 'ensureInputValues', getTxFn).then(function (tx) {
      var affectingInputs = _.chain(outputSet)
        .map(function (outIndex) { return getXferAffectingInputs(tx, padding, outIndex) })
        .flatten()
        .uniq()
        .map(function (ii) { return tx.ins[ii] })
        .value()

      return affectingInputs
    })

  }).done(function (result) { cb(null, result) }, function (error) { cb(error) })
}

/**
 * Create ComposeTx from OperationalTx
 *
 * @param {OperationalTx} operationalTx
 * @param {ColorDefinition~transformToComposedTxCallback} cb
 */
EPOBCColorDefinition.makeComposedTx = function (operationalTx, cb) {
  verify.OperationalTx(operationalTx)
  verify.function(cb)

  var targetsByColor
  var targetsColorIds
  var uncoloredTargets
  var uncoloredNeeded
  var dustThreshold
  var coinsByColor
  var minPadding
  var composedTx
  var tag

  Q.fcall(function () {
    targetsByColor = util.groupTargetsByColor(operationalTx.getTargets(), EPOBCColorDefinition)

    uncoloredTargets = targetsByColor[new UncoloredColorDefinition().getColorId()] || []
    delete targetsByColor[new UncoloredColorDefinition().getColorId()]

    if (uncoloredTargets.length === 0) {
      uncoloredNeeded = new ColorValue(new UncoloredColorDefinition(), 0)

    } else {
      uncoloredNeeded = ColorTarget.sum(uncoloredTargets)

    }

    targetsColorIds = Object.keys(targetsByColor)
    dustThreshold = operationalTx.getDustThreshold()
    coinsByColor = {}
    minPadding = 0

    // get inputs, create change targets, compute min padding
    var promise = Q()
    targetsColorIds.forEach(function (targetColorId) {
      promise = promise.then(function () {
        var targets = targetsByColor[targetColorId]
        var neededSum = ColorTarget.sum(targets)

        return Q.ninvoke(operationalTx, 'selectCoins', neededSum, null).spread(function (coins, coinsValue) {
          coinsByColor[targetColorId] = coins.map(function (coin) { return coin.toRawCoin() })

          var change = coinsValue.minus(neededSum)
          if (change.getValue() > 0) {
            var changeAddress = operationalTx.getChangeAddress(change.getColorDefinition())
            var changeScript = util.address2script(changeAddress)
            var changeTarget = new ColorTarget(changeScript.toHex(), change)
            targets.push(changeTarget)
          }

          targets.forEach(function (target) {
            var paddingNeeded = dustThreshold.getValue() - target.getValue()
            if (paddingNeeded > minPadding) { minPadding = paddingNeeded }
          })
        })
      })
    })

    return promise

  }).then(function () {
    composedTx = operationalTx.makeComposedTx()
    tag = new Tag(Tag.closestPaddingCode(minPadding), false)

    // create txins & txouts, compute uncolored requirements
    targetsColorIds.forEach(function (targetColorId) {
      coinsByColor[targetColorId].forEach(function (coin) {
        var coinValue = new ColorValue(new UncoloredColorDefinition(), coin.value)
        uncoloredNeeded = uncoloredNeeded.minus(coinValue)
        composedTx.addTxIn(coin)
      })

      targetsByColor[targetColorId].forEach(function (target) {
        var targetValue = target.getValue() + tag.getPadding()
        var uncoloredValue = new ColorValue(new UncoloredColorDefinition(), targetValue)
        uncoloredNeeded = uncoloredNeeded.plus(uncoloredValue)
        composedTx.addTxOut({script: target.getScript(), value: targetValue})
      })
    })

  }).then(function () {
    composedTx.addTxOuts(uncoloredTargets.map(function (target) { return {target: target} }))

    var fee = composedTx.estimateRequiredFee()
    if (uncoloredNeeded.plus(fee).getValue() <= 0) {
      return uncoloredNeeded.plus(fee).neg()
    }

    return Q.ninvoke(operationalTx, 'selectCoins', uncoloredNeeded, composedTx).spread(function (coins, coinsValue) {
      composedTx.addTxIns(coins.map(function (coin) { return coin.toRawCoin() }))
      fee = composedTx.estimateRequiredFee()
      return coinsValue.minus(uncoloredNeeded).minus(fee)
    })

  }).then(function (uncoloredChange) {
    if (uncoloredChange.getValue() > dustThreshold.getValue()) {
      var uncoloredAddress = operationalTx.getChangeAddress(new UncoloredColorDefinition())
      composedTx.addTxOut({
        script: util.address2script(uncoloredAddress).toHex(),
        value: uncoloredChange.getValue()
      })
    }

    composedTx.setTxInSequence(0, tag.toSequence())

  }).done(function () { cb(null, composedTx) }, function (error) { cb(error) })
}

/**
 * @param {OperationalTx} operationalTx
 * @param {ColorDefinition~transformToComposedTxCallback} cb
 */
EPOBCColorDefinition.composeGenesisTx = function (operationalTx, cb) {
  verify.OperationalTx(operationalTx)
  verify.function(cb)

  var tag
  var composedTx
  var uncoloredNeeded

  Q.fcall(function () {
    if (operationalTx.getTargets().length !== 1) {
      throw new errors.ComposeGenesisTxError('Genesis transaction need exactly one target')
    }

    var gTarget = operationalTx.getTargets()[0]
    if (gTarget.getColorId() !== new GenesisColorDefinition().getColorId()) {
      throw new errors.IncompatibilityColorDefinitionsError('Transaction target is not genesis')
    }

    var gValue = gTarget.getValue()
    var paddingNeeded = operationalTx.getDustThreshold().getValue() - gValue
    tag = new Tag(Tag.closestPaddingCode(paddingNeeded), true)

    composedTx = operationalTx.makeComposedTx()
    composedTx.addTxOut({script: gTarget.getScript(), value: tag.getPadding() + gValue})

    uncoloredNeeded = new ColorValue(new UncoloredColorDefinition(), tag.getPadding() + gValue)

    return Q.ninvoke(operationalTx, 'selectCoins', uncoloredNeeded, composedTx)

  }).spread(function (coins, coinsValue) {
    composedTx.addTxIns(coins.map(function (coin) { return coin.toRawCoin() }))

    var fee = composedTx.estimateRequiredFee()
    var uncoloredChange = coinsValue.minus(uncoloredNeeded).minus(fee)
    if (uncoloredChange.getValue() > operationalTx.getDustThreshold().getValue()) {
      var uncoloredAddress = operationalTx.getChangeAddress(new UncoloredColorDefinition())
      composedTx.addTxOut({
        script: util.address2script(uncoloredAddress).toHex(),
        value: uncoloredChange.getValue()
      })
    }

    composedTx.setTxInSequence(0, tag.toSequence())

  }).done(function () { cb(null, composedTx) }, function (error) { cb(error) })
}


EPOBCColorDefinition._Tag = Tag
EPOBCColorDefinition._getXferAffectingInputs = getXferAffectingInputs

ColorDefinitionManager.registerColorDefinition('epobc', EPOBCColorDefinition)


module.exports = EPOBCColorDefinition
