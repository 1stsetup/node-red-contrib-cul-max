


/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

const cmd2MsgId = {
	"SetTemperature": "40",
	"ConfigWeekProfile": "10",
	"SetDisplayActualTemperature": "82",
	"TimeInformation": "03",
	"AddLinkPartner": "20",
	"RemoveLinkPartner": "21"
}

const WEEKDAYS = {
	"sat": 0,
	"sun": 1,
	"mon": 2,
	"tue": 3,
	"wed": 4,
	"thu": 5,
	"fri": 6,
	"saturday": 0,
	"sunday": 1,
	"monday": 2,
	"tuesday": 3,
	"wednesday": 4,
	"thursday": 5,
	"friday": 6
}

var device_types_by_name = {
	"Cube": 0,
	"HeatingThermostat": 1,
	"HeatingThermostatPlus": 2,
	"WallMountedThermostat": 3,
	"ShutterContact": 4,
	"PushButton": 5
};

function prefix(inStr, char, len) {
	var result = inStr;
	while (result.length < len) {
		result = char + result;
	}
	return result;
}

module.exports = function (RED) {

	/**
	 * ====== CUL-CONTROLLER ================
	 * Holds configuration for culjs,
	 * initializes new culjs connections
	 * =======================================
	 */
	function CULMaxThermostat(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		this.controller = RED.nodes.getNode(config.controller);
		this.address = config.address;
		this.minvalve = config.hasOwnProperty("minvalve") ? config.minvalve : 20;
		this.useForHeating = config.useForHeating;

		var node = this;

		if (node.controller && node.controller.addReceivingDevice) {
			node.controller.addReceivingDevice(node);
		}

		this.on("close", function () {
			node.controller && node.controller.removeReceivingDevice && node.controller.removeReceivingDevice(node);
		});

		node.updateStatus = function () {
			var newText = "";
			switch (node.device.device) {
				case "HeatingThermostat":
					newText += `Valve: ${node.device.valveposition !== undefined ? node.device.valveposition : "-"}% - `;
				case "WallMountedThermostat":
					newText += `${node.device.measuredTemperature || "-"}°C/${node.device.desiredTemperature || "-"}°C, Battery: ${node.device.battery}`
					break;
				case "ShutterContact":
					newText += `State: ${node.device.isopen == 1 ? "Open" : "Closed"}, Battery: ${node.device.battery}`
					break;
				case "PushButton":
					newText += `Battery: ${node.device.battery}`
					break;
			}
			node.status({
				fill: "green",
				shape: "dot",
				text: newText
			});

		}

		this.on("data", function (device) {
			if (device != null) {
				node.send({
					topic: "cul-max-thermostat:" + node.address,
					payload: device
				})
				node.device = device;
				node.updateStatus();
			}
		});


		// 		// Check if we want heating or not.
		// if (node.devices[device.address]["measuredTemperature-diff"] && node.devices[device.address]["desiredTemparature"]) {
		// 	// Calculate what the temperature will be in 5 minutes

		// }

		/* ===== Node-Red events ===== */
		this.doSyncTime = function (done) {

			if (done) {
				done();
			}
		}

		this.setTimeInformation = function (payload, send, done) {
			// my ($sec,$min,$hour,$day,$mon,$year,$wday,$yday,$isdst) = localtime(time());
			// $mon += 1; #make month 1-based
			// #month encoding is just guessed
			// #perls localtime gives years since 1900, and we need years since 2000
			// return unpack("H*",pack("CCCCC", $year - 100, $day, $hour, $min | (($mon & 0x0C) << 4), $sec | (($mon & 0x03) << 6)));

			let bits = [];
			if (payload === undefined) {
				let now = new Date();
				let year = now.getFullYear() - 2000;
				let month = now.getMonth() + 1;
				bits.push(year, now.getDate(), now.getHours(), now.getMinutes() | ((month & 0x0C) << 4), now.getSeconds() | ((month & 0x03) << 6));
			}
			else {
				if ("year" in payload && "month" in payload && "day" in payload &&
					"hour" in payload && "minute" in payload && "second" in payload) {
					let year = payload.year - 2000;
					bits.push(year, payload.day, payload.hour, payload.minute | ((payload.month & 0x0C) << 4), payload.second | ((payload.month & 0x03) << 6));
				}
			}
			if (bits.length > 0) {
				let culMaxPayload = "";
				for (let idx = 0; idx < bits.length; idx++) {
					culMaxPayload += prefix(bits[idx].toString(16), '0', 2)
				}
				node.controller.emit("sendTo", node.address, cmd2MsgId["TimeInformation"], culMaxPayload);
			}
			if (done) {
				done();
			}
		}


		this.setDisplayActualTemperature = function (payload, send, done) {
			if (payload !== undefined) {
				let bits = payload ? 4 : 0;
				let culMaxPayload = prefix(bits.toString(16), '0', 2);
				node.controller.emit("sendTo", node.address, cmd2MsgId["SetDisplayActualTemperature"], culMaxPayload);
			}
			if (done) {
				done();
			}
		}

		this.setTemperature = function (payload, send, done) {
			// Construct payload for controller
			let culMaxPayload;
			if (payload) {
				let bits = 0;
				if (payload.hasOwnProperty("mode")) {
					bits = payload.mode << 6;
				}
				if (payload.hasOwnProperty("desiredTemperature")) {
					bits |= (payload.desiredTemperature * 2) & 0x3F;
				}
				culMaxPayload = prefix(bits.toString(16), '0', 2);
				if (payload.hasOwnProperty("until")) {
					//$until = sprintf("%06x",(($month&0xE) << 20) | ($day << 16) | (($month&1) << 15) | (($year-2000) << 8) | ($hour*2 + int($min/30)));

					//bits |= (payload.desiredTemperature * 2) & 0x3F;
				}
				node.controller.emit("sendTo", node.address, cmd2MsgId["SetTemperature"], culMaxPayload);
			}
			if (done) {
				done();
			}
		}

		this.addLinkPartner = function (payload, send, done) {
			// Construct payload for controller
			let culMaxPayload;
			if (payload) {
				culMaxPayload = payload;
				if (payload in node.controller.devices) {
					if (node.controller.devices[payload].device in device_types_by_name) {
						culMaxPayload += prefix(device_types_by_name[node.controller.devices[payload].device].toString(16), '0', 2);
						node.log(`%%%% ${culMaxPayload}`)
						node.controller.emit("sendTo", node.address, cmd2MsgId["AddLinkPartner"], culMaxPayload);
					}
					else {
						node.log(`Unknown device type: ${node.controller.devices[payload].device}`)
					}
				}
				else {
					node.log(`Unknown address: ${payload}`)
				}
			}
			if (done) {
				done();
			}
		}

		this.setControlPoints = function (payload, send, done) {
			// Construct payload for controller
			// example payload: 0 2 3C45 5454 3CFE 5508 3D20 4520 4520 0 7
			// 0x3c45 == 15429 == 0b11110001000101
			//   temp >> 9 == 0b11110 == 30
			//   time == 0b001000101 == 69 --> * 5 == 345
			// 0x5454 == 21588 == 0b101010001010100
			//   temp >> 9 == 0b101010
			// weekday 2 monday
			// 1st point temp 15degC 0:00
			// 2nd point temp 21degC 05:45
			// 3rd point temp 15deg 07:00
			// 4th point temp 21deg 21:10
			// 5th point temp 15deg 22:00
			//
			// $newWeekprofilePart .= sprintf("%04x", (int($temperature*2) << 9) | int(($hour * 60 + $min)/5));
			// First 7 control points sprintf("0%1d%s", $day, substr($newWeekprofilePart,0,2*2*7))
			// Remaining 6 control points sprintf("1%1d%s", $day, substr($newWeekprofilePart,2*2*7,2*2*6))
			// First digit specifies which set of control points:
			//   0 : first 7
			//   1 : remaining 6
			// Second digit is weekday
			//  (0 => 'Sat', 1 => 'Sun', 2 => 'Mon', 3 => 'Tue', 4 => 'Wed', 5 => 'Thu', 6 => 'Fri');
			//
			// Next 7 or 6 2 byte hex values are controlpoints
			// Last two digits are unknown for now ??
			// data.setId = data.payload.substr(0,1);
			// let controlpointCount = (data.setId == 0) ? 7 : 6;
			// if (data.payload.length >= (2+controlpointCount*4)) {
			// 	data.weekday = data.payload.substr(1,1);
			// 	data.weekdayStr = day2str[data.weekday];
			// 	data.controlpoints = [];
			// 	let previousHour = 0;
			// 	let previousMinute = 0;
			// 	for(var i=0; i<controlpointCount; i++) {
			// 		let controlpoint = hex2byte(data.payload.substr(2+(i*4),4));
			// 		let temperature = ((controlpoint >> 9) & 0x3F) / 2;
			// 		let time = (controlpoint & 0x1FF) * 5;
			// 		let hour = Math.floor((time / 60) % 24);
			// 		let minute = time % 60;

			if (payload && ("controlPoints" in payload) && ("weekday" in payload)) {
				let messages = [];
				let bits = [];

				// Push first set of ocntrol points
				bits.push("0");

				// Push weekday number
				let weekday;
				if (typeof payload.weekday == "number") {
					weekday = payload.weekday.toString(16);
					bits.push(weekday);
				}
				else {
					if (payload.weekday.toLowerCase() in WEEKDAYS) {
						weekday = WEEKDAYS[payload.weekday.toLowerCase()].toString(16)
						bits.push(weekday);
					}
					else {
						if (done) done();
						return;
					}
				}

				// push controlpoints.
				// Our array must contain a temperature en the time when this temperature will be set.
				// We are first going to sort on time.
				payload.controlPoints.sort((a, b) => {
					if (((a.hour * 100) + a.minute) < ((b.hour * 100) + b.minute)) return -1;
					if (((a.hour * 100) + a.minute) > ((b.hour * 100) + b.minute)) return 1;
					return 0;
				})

				// We now need to build out list where the first part is first temperature but time of second.
				// The last part will have last temperature and time 00:00.
				for (let idx = 0; idx < payload.controlPoints.length; idx++) {
					if (idx == 7) {
						messages.push(bits);
						let weekday = bits[1];
						bits = ["1", weekday];
					}
					let temp = payload.controlPoints[idx].temperature;
					let hour = 24;
					let minute = 0;
					if (idx < payload.controlPoints.length - 1) {
						hour = payload.controlPoints[idx + 1].hour;
						minute = payload.controlPoints[idx + 1].minute;
					}
					let time = Math.round(((hour + (minute / 60)) * 60) / 5);

					let data = ((temp * 2) << 9) + time;
					bits.push(prefix(data.toString(16), '0', 4))
				}

				let len = (bits[0] == "0") ? 7 : 6;
				while (bits.length < len + 2) {
					bits.push("4520");
				}

				messages.push(bits);

				if (messages.length == 1) {
					// Add second empty message.
					messages.push([`1${weekday}`]);
				}

				console.log(`messages.length: ${messages.length}`)
				for (let idx = 0; idx < messages.length; idx++) {
					console.log(`messages[idx]: ${messages[idx]}`)
					let culMaxPayload = messages[idx].join("");
					console.log(`Going to send 'ConfigWeekProfile':${culMaxPayload}`);
					node.controller.emit("sendTo", node.address, cmd2MsgId["ConfigWeekProfile"], culMaxPayload);
				}
			}
			if (done) {
				done();
			}
		}

		this.on("input", function (msg, send, done) {
			send = send || function () { node.send.apply(node, arguments) };
			if (msg && msg.hasOwnProperty("topic")) {
				let device;
				switch (msg.topic) {
					case "list":
						if (send) {
							send([{
								topic: "cul-max:" + node.address,
								payload: node.controller.getDevice(node.address)
							}, null]);
						}
						if (done) {
							done();
						}
						break;
					case "SetTemperature":
						device = node.controller.getDevice(node.address);
						if (device !== null && (device.device == "HeatingThermostat" || device.device == "WallMountedThermostat")) {
							node.setTemperature(msg.payload, send, done);
						}
						else {
							if (done) {
								done();
							}
						}
						break;
					case "SetControlPoints":
						device = node.controller.getDevice(node.address);
						console.log(`device: ${device.device}`)
						if (device !== null && (device.device == "HeatingThermostat" || device.device == "WallMountedThermostat")) {
							node.setControlPoints(msg.payload, send, done);
						}
						else {
							if (done) {
								done();
							}
						}
						break;
					case "SetDisplayActualTemperature":
						device = node.controller.getDevice(node.address);
						console.log(`device: ${device.device}`)
						if (device !== null && device.device == "WallMountedThermostat") {
							node.setDisplayActualTemperature(msg.payload, send, done);
						}
						else {
							if (done) {
								done();
							}
						}
						break;
					case "SetTimeInformation":
						device = node.controller.getDevice(node.address);
						console.log(`device: ${device.device}`)
						if (device !== null && (device.device == "HeatingThermostat" || device.device == "WallMountedThermostat")) {
							node.setTimeInformation(msg.payload, send, done);
						}
						else {
							if (done) {
								done();
							}
						}
						break;
					case "AddLinkPartner":
						device = node.controller.getDevice(node.address);
						if (device !== null && (device.device == "HeatingThermostat" || device.device == "WallMountedThermostat")) {
							node.addLinkPartner(msg.payload, send, done);
						}
						else {
							if (done) {
								done();
							}
						}
						break;
					default:
						if (done) {
							done();
						}
				}
			}
			else {
				if (done) {
					done();
				}
			}



		});

		this.on("close", function (removed, done) {
			if (done) {
				done();
			}
		});

	}

	RED.nodes.registerType("cul-max-thermostat", CULMaxThermostat);
	RED.nodes.registerType("cul-max-radiatorthermostat", CULMaxThermostat);
	RED.nodes.registerType("cul-max-ShutterContact", CULMaxThermostat);
	RED.nodes.registerType("cul-max-PushButton", CULMaxThermostat);
	console.log("Yup cul-max-thermostat");

}
