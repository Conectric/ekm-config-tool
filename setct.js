const gateway = require('conectric-usb-gateway-beta');
const ekmDecoder = require('./ekmdecoder');
const Joi = require('@hapi/joi');
const path = require('path');

// This will store the list of meters to work through.
let meterMappings;

// Tracking current state.
let currentMessage;
let currentTrackingId;
let currentMeterIndex = 0;

const encodeDigits = digits => {
  let encodedDigits = '';

  for (let n = 0; n < digits.length; n++) {
    encodedDigits = `${encodedDigits}3${digits[n]}`;
  }

  return encodedDigits;
};

const verifyMeterMappings = () => {
  const validationResult = Joi.validate(meterMappings, Joi.object().keys({
    meters: Joi.array().items(Joi.object().keys({
      serialNumber: Joi.string().length(12).required(),
      rs485HubId: Joi.string().length(4).required(),
      version: Joi.number().integer().min(3).max(4).required(),
      password: Joi.string().length(8).regex(/[0-9]{8}/).optional(),
      ctRatio: Joi.number().integer().min(100).max(5000).optional()
    }).optional())
  }).required().options({
    allowUnknown: false
  }));

  if (validationResult.error) {
    console.error('Errors detected in config file:');
    console.error(validationResult.error.message);
    process.exit(1);
  }

  for (const meter of meterMappings.meters) {
    meter.hexSerialNumber = encodeDigits(meter.serialNumber);

    if (meter.hasOwnProperty('password')) {
      meter.hexPassword = encodeDigits(meter.password);
    }

    if (meter.hasOwnProperty('ctRatio')) {
      let hexCtRatio = encodeDigits(`${meter.ctRatio}`);
      // Add leading 0 if 6 chars...
      if (hexCtRatio.length === 6) {
        hexCtRatio = `30${hexCtRatio}`;
      }

      meter.hexCtRatio = hexCtRatio;
    }
  }

  metersEnabled = (meterMappings.meters.length > 0);

  if (! metersEnabled) {
    console.log('Nothing to do - no meters found in meters.json.');
    process.exit(0);
  }
};

const getNextMeter = (fromStart) => {
  // Starting at currentMeterIndex or 0 if fromStart is true, 
  // find the next meter that has a password and ct ratio set...
  let i = (fromStart ? 0 : currentMeterIndex + 1);

  while (i < meterMappings.meters.length) {
    const thisMeter = meterMappings.meters[i];
    
    if (thisMeter.hasOwnProperty('password') && thisMeter.hasOwnProperty('ctRatio')) {
      // This is good.
      currentMeterIndex = i;
      return thisMeter;
    }

    i++;
  }

  // Didn't find any more meters to configure, so done.
  return false;
};

const getCurrentMeter = () => {
  return meterMappings.meters[currentMeterIndex];
};

const startNextMeterConfigProcess = (isFirstMeter) => {
  setTimeout(() => {
    // Get the first valid meter.
    const currentMeter = getNextMeter(isFirstMeter);

    if (! currentMeter) {
      console.log('Processed all meters.');
      process.exit(0);
    }

    currentMessage = 1;
    currentTrackingId = 'dddd';
    gateway.sendRS485Request({
      // MESSAGE 1.
      message: `2F3F${currentMeter.hexSerialNumber}${currentMeter.version === 4 ? '3030': ''}210D0A`,
      destination: currentMeter.rs485HubId,
      hexEncodePayload: false,
      trackingId: currentTrackingId
    });

    console.log(`Sent first configuration message to meter ${currentMeter.serialNumber}`);
  }, 2000);
};

// Check the parameters we were called with.
if (process.argv.length !== 4) {
  console.error('Usage: npm run setct.js <meters.json_file>');
  process.exit(1);
}

// Load meters file and verify it.
const metersFileLocation = path.resolve(__dirname, '', process.argv[3]);

try {
  meterMappings = require(metersFileLocation);
} catch (e) {
  console.error(`Failed to load ${metersFileLocation}`);
  process.exit(1);
}

verifyMeterMappings();

gateway.runGateway({
  onGatewayReady: () => {
    console.log('Gateway is ready.');

    startNextMeterConfigProcess(true);
  },
  onSensorMessage: (sensorMessage) => {
    if (sensorMessage.hasOwnProperty('trackingId') && sensorMessage.trackingId === currentTrackingId) {
      console.log(sensorMessage);

      const currentMeter = getCurrentMeter();

      if (sensorMessage.type === 'rs485Response' && sensorMessage.payload.rs485 !== '06') {
        console.log(`ERROR: Bad response from meter ${currentMeter.serialNumber}`);

        // Move on to next meter, if any...
        startNextMeterConfigProcess(false);
        return;
      }

      let nextMessage

      switch (currentMessage) {
        case 1:
          // Create the password message.
          nextMessage = ekmDecoder.addCrc(`0150310228${currentMeter.hexPassword}2903`);
          nextTrackingId = 'eeee';
          break;
        case 2:
          // Create the CT message.
          nextMessage = ekmDecoder.addCrc(`015731023030443028${currentMeter.hexCtRatio}2903`);
          nextTrackingId = 'eeef';
          break;
        case 3:
          // Create the terminate message.
          nextMessage = '0142300375';
          nextTrackingId = 'eeff';
          break;
        default:
          console.log(`Unknown value for currentMessage ${currentMessage}`);
      }

      // Send any message
      if (nextMessage) {
        currentTrackingId = nextTrackingId;

        gateway.sendRS485Request({
          message: nextMessage,
          destination: sensorMessage.sensorId,
          hexEncodePayload: false,
          trackingId: currentTrackingId
        });

        console.log(`Sent message ${nextMessage}`);

        if (currentMessage === 3) {
          console.log(`Configuration process completed for meter ${currentMeter.serialNumber}`);

          // Move on to next meter, if any.
          startNextMeterConfigProcess(false);
          return;
        } else {
          currentMessage++;
        }
      }
    }
  },
  useTrackingId: true
});
