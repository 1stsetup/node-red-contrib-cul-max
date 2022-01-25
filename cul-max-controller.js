/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

var util = require('util');
var Cul = require('cul');
const fs = require('fs');
const path = require('path');
const { deflateRawSync } = require('zlib');

const SAVED_MAX_DEVICES = "_saved_max_devices.json";
const ACK_TIMEOUT = 3000; // 3 seconds

const IGNORE_FIELDS = [
	"len",
	"src",
	"dst",
	"dstDevice",
	"payload",
	"getKeyByValue"
]

const cmd2MsgId = {
	"PairPong": "01"
}

function prefix(inStr, char, len) {
	var result = inStr;
	while (result.length < len) {
		result = char + result;
	}
	return result;
}

let msgCounter = 0;
function nextMsgCounter() {
	msgCounter = (msgCounter + 1) & 0xFF;
	return prefix(msgCounter.toString(16), '0', 2);
}

module.exports = function (RED) {

	var self = this;
	self.controllers = {};
	/**
	 * ====== CUL-CONTROLLER ================
	 * Holds configuration for culjs,
	 * initializes new culjs connections
	 * =======================================
	 */
	function CULMaxControllerNode(config) {
		RED.nodes.createNode(this, config);
		this.name = config.name;
		this.address = config.address;
		var node = this;
		this.receivingDevices = {};

		this.sendQueue = [];
		this.sendTimeout;

		this.inPairMode = false;

		node.setInPairMode = function (value) {
			node.inPairMode = value;
		}

		node.getInPairMode = function (value) {
			return node.inPairMode;
		}

		if (!self.controllers) {
			self.controllers = {};
		}
		self.controllers[this.id] = this;

		this.devices = {};

		node.getDevice = function (address) {
			if (node.devices[address]) {
				return node.devices[address];
			}
			return null;
		}

		this.needPreamble = true;
		this.waitingForCredit = false;

		this.sleepFactor = 10;

		node.checkAvailableTime = function (availableTime, wait) {
			let sleepTime = wait * 10 * (availableTime === undefined ? 1 : node.sleepFactor);
			if (sleepTime < 2000 && availableTime !== undefined) sleepTime = 5000;

			node.log(`Waiting for enough credit. Sleeping: ${sleepTime}ms`);
			node.waitingForCredit = true;
			setTimeout(() => {
				node.send([null, {
					topic: "raw",
					payload: "X"
				}]);
			}, sleepTime);
		}

		node.resendPacket = function (availableTime) {
			node.updateStatus(availableTime);
			if (node.waitingForCredit) return;
			if (node.sendQueue.length > 0) {
				let timeNeeded = (node.needPreamble ? 100 : 0) + (node.sendQueue[0].len * 8) / 10;

				if (availableTime !== undefined && timeNeeded <= availableTime) {
					// We can really send data.
					node.log(`Enough credit available. We need: ${timeNeeded} and have available ${availableTime}`)
					if (node.sendQueue[0].tryCount < 3) {
						node.sendQueue[0].tryCount++;
						node.log("sendTo packet:" + node.sendQueue[0].packetStr + "|");
						node.send([null, {
							topic: "raw",
							payload: node.sendQueue[0].packetStr
						}])

						node.sendTimeout = setTimeout(node.resendPacket, ACK_TIMEOUT);

					}
					else {
						// unable to send. Drop this request.
						node.log(`Destination '${node.sendQueue[0].dst}' is not responding to packets. Dropping packets.`);
						node.sendQueue.shift();
						node.sendTimeout = undefined;
						node.resendPacket();
					}
					return;
				}
				else {
					node.log(`availableTime: ${availableTime}, timeNeeded: ${timeNeeded}`);
					node.checkAvailableTime(availableTime, timeNeeded - (availableTime === undefined ? 0 : availableTime));
					return;
				}

			}
		}
		node.addToSendQueue = function (src, dst, packetStr, len) {
			node.sendQueue.push({
				src: src,
				dst: dst,
				packetStr: packetStr,
				len: len,
				tryCount: 0
			});
			if (!node.sendTimeout) {
				node.resendPacket();
			}
			node.updateStatus();
		}

		node.on("sendTo", function (address, cmd, payload) {
			// Z 0B 1F 00 40 123456 0E14C1 00 65 05
			let packet = {
				msgCnt: nextMsgCounter(),
				msgFlag: "00",
				msgType: cmd,
				src: node.address,
				dst: address,
				groupId: "00",
				payload: payload,
				toString: function () {
					return (this.msgCnt + this.msgFlag + this.msgType + this.src + this.dst + this.groupId + this.payload).toUpperCase();
				}
			};

			let packetStr = packet.toString();
			let len = prefix((packetStr.length / 2).toString(16), '0', 2).toUpperCase();
			packetStr = "Zs" + len + packetStr;
			node.addToSendQueue(node.address, address, packetStr, packetStr.length / 2);
		});

		node.updateStatus = function (availableTime) {
			let count = 0;
			for (var address in node.devices) {
				count++;
			}

			node.status({
				fill: "green",
				shape: "dot",
				text: `${count} devices, sendQueue: ${node.sendQueue.length}${availableTime === undefined ? "" : ", credit:" + availableTime}`
			});

		}

		node.loadDevices = function (data) {
			for (var address in data) {
				if (node.devices[address]) {
					// update
				}
				else {
					// add
					node.devices[address] = data[address];
				}
			}
			node.updateStatus();
		}

		console.log("CUL-MAX-Controller file:" + this.address + SAVED_MAX_DEVICES);

		// Load any saved max devices
		fs.stat(this.address + SAVED_MAX_DEVICES, (err, stats) => {
			if (!err) {
				if (stats.isFile()) {
					node.status({
						fill: "green",
						shape: "ring",
						text: "Loading saved devices"
					});
					fs.readFile(node.address + SAVED_MAX_DEVICES, (err, data) => {
						if (err) {
							node.updateStatus();
							return;
						}
						try {
							node.loadDevices(JSON.parse(data.toString()));
						}
						catch (err) {
							node.log(`Error loading data from file ${node.address + SAVED_MAX_DEVICES}. Error:${err}`)
						}
					})
				}
			}
		});

		node.processMaxMsg = function (device, data, send, done) {
			var now = (new Date()).getTime() / 1000;

			if (!node.devices[device.address]) {
				node.devices[device.address] = {
					sendTo: {},
					receivedFrom: {}
				};
			}

			if (device["device"]) {
				node.devices[device.address].device = device.device;
			}

			if (node.receivingDevices[device.address]) {
				if (node.devices[device.address].name != node.receivingDevices[device.address].name) {
					node.log(`Adding name '${node.receivingDevices[device.address].name}' to address '${device.address}'`)
					node.devices[device.address].name = node.receivingDevices[device.address].name;
				}
			}

			if (data) {
				for (let field in data) {
					switch (field) {
						case "address":
						case "getKeyByValue":
							break;
						case "src":
							node.processMaxMsg({
								address: data.src
							});
							if (data.src !== device.address) {
								node.devices[data.src].sendTo[device.address] = data;
								node.devices[device.address].receivedFrom[device.src] = data;
							}
							break;
						case "dst":
							var newData;
							switch (data.msgType) {
								case "ConfigTemperatures":
									newData = {
										comfortTemperature: data.comfortTemperature,
										ecoTemperature: data.ecoTemperature,
										maximumTemperature: data.maximumTemperature,
										minimumTemperature: data.minimumTemperature,
										offset: data.offset,
										windowOpenTemperature: data.windowOpenTemperature,
										windowOpenTime: data.windowOpenTime
									}
									break;
								case "SetTemperature":
									newData = {
										mode: data.mode,
										modeStr: data.modeStr
									}
									if (data.desiredTemperature) {
										newData.desiredTemperature = data.desiredTemperature
									}
									break;
								case "ConfigWeekProfile":
									newData = {
										setId: data.setId,
										weekday: data.weekday,
										weekdayStr: data.weekdayStr
									}
									newData["controlpoints-" + data.weekday] = data.controlpoints;
									break;
								case "PairPing":
									// When dst address is "000000" or our address we will PairPong it.
									node.log(`Received PairPing from ${data.src} for ${data.dst}`);
									if (data.dst == "000000" || data.dst == node.address) {
										node.log(` PairPong is for us.`)
										if (node.inPairMode === true) {
											node.log(` We are in PairMode so we are going to send a PairPong back.`)
											node.emit("sendTo", data.src, cmd2MsgId["PairPong"], "00");
										}
									}
									break;
							}
							node.processMaxMsg({
								address: data.dst,
								device: data.dstDevice
							}, newData);
							if (device.address !== data.dst) {
								node.devices[device.address].sendTo[data.dst] = data;
								node.devices[data.dst].receivedFrom[device.address] = data;
							}
							break;
						default:
							// Calculate difference to last time
							switch (field) {
								case "measuredTemperature":
								case "valveposition":
									if (data[field] !== null && data[field] !== undefined) {
										let previousValue = node.devices[device.address][field] || 0;
										node.devices[device.address][field + "-prev"] = previousValue;
										let currentValue = data[field];
										let valueDiff = currentValue - previousValue;
										let timeDiff = now - (node.devices[device.address][field + "-timestamp"] || now);
										let speed = valueDiff / timeDiff;
										if (isNaN(speed)) {
											speed = 0;
										}
										node.devices[device.address][field + "-diff"] = valueDiff;
										node.devices[device.address][field + "-speed"] = speed;
										node.devices[device.address][field + "-timestamp"] = now;
									}
									break;
								case "msgType":
									if ((data[field] == "Ack") && (node.sendQueue.length > 0)) {
										// See if this is an ack to one of our message we send out.
										if (data.src == node.sendQueue[0].dst && data.dst == node.sendQueue[0].src) {
											node.log(`Received ack to msg: ${node.sendQueue[0].packetStr}`);
											clearTimeout(node.sendTimeout);
											node.sendTimeout = undefined;
											node.sendQueue.shift();
											node.resendPacket();
										}
									}
							}

							if (data[field] !== null && data[field] !== undefined) {
								node.devices[device.address][field] = data[field];
							}
							break;
					}
				}

				// Check if this node needs heating?
				var tempNeedHeat1 = false;
				var tempNeedHeat2 = false;
				if (node.devices[device.address].hasOwnProperty("measuredTemperature") &&
					node.devices[device.address].hasOwnProperty("desiredTemperature") &&
					node.devices[device.address].hasOwnProperty("measuredTemperature-speed")) {
					let tempIncrease = (node.devices[device.address]["measuredTemperature-speed"] * (5 * 60)); //Increase of temp in 5 minutes.
					tempNeedHeat1 = node.devices[device.address].measuredTemperature < node.devices[device.address].desiredTemperature;
					tempNeedHeat2 = (node.devices[device.address].measuredTemperature + tempIncrease) < node.devices[device.address].desiredTemperature;
				}

				// Check if this node needs heating?
				var valveNeedHeat = false;
				if (node.devices[device.address].hasOwnProperty("valveposition") &&
					node.receivingDevices[device.address]) {
					//						valveNeedHeat = (((node.devices[device.address].valveposition > node.receivingDevices[device.address].minvalve) && (node.devices[device.address]["valveposition-diff"] >= 0)) || (node.devices[device.address].valveposition >= 50));
					valveNeedHeat = (node.devices[device.address].valveposition > node.receivingDevices[device.address].minvalve);
				}


				let receivingDevice = node.receivingDevices[device.address];
				if (receivingDevice) {
					//node.log(`name:${node.devices[device.address].name}, useForHeating:${receivingDevice.useForHeating}`)
					if ("useForHeating" in receivingDevice && receivingDevice.useForHeating === true) {
						let globalNeedHeating = node.context().global.get("needHeating");
						if (!globalNeedHeating) {
							globalNeedHeating = {};
						}
						globalNeedHeating[device.address] = {
							tempNeedHeat: tempNeedHeat2,
							valveNeedHeat: valveNeedHeat
						}
						node.context().global.set("needHeating", globalNeedHeating);
					}
				}

				if (send) {
					send([{
						topic: "cul-max:message",
						address: device.address,
						payload: node.devices[device.address],
						needHeat: {
							tempNeedHeat: tempNeedHeat2,
							valveNeedHeat: valveNeedHeat
						}
					}, null]);
				}

				if (node.receivingDevices[device.address]) {
					node.receivingDevices[device.address].emit("data", node.devices[device.address]);
				}
			}

			node.updateStatus();

			node.saveDevices(done);

		}

		this.addReceivingDevice = function (receiver) {
			node.receivingDevices[receiver.address] = receiver;
		}

		this.removeReceivingDevice = function (receiver) {
			if (node.receivingDevices[receiver.address]) {
				delete node.receivingDevices[receiver.address];
			}
		}

		/* ===== Node-Red events ===== */
		this.on("input", function (msg, send, done) {
			send = send || function () { node.send.apply(node, arguments) };

			//node.log("Msg for cul-max-controller:" + JSON.stringify(msg));

			if (msg["topic"] &&
				msg.topic === "cul:message" &&
				msg["payload"] &&
				"availableTime" in msg.payload) {
				node.log(`we received availableTime: ${msg.payload.availableTime}, waitingForCredit: ${node.waitingForCredit}`);
				if (node.waitingForCredit) {
					node.waitingForCredit = false;
					node.resendPacket(msg.payload.availableTime);
				}
			}

			if (msg["topic"] &&
				msg.topic === "cul:message" &&
				msg["payload"] &&
				msg.payload["protocol"] &&
				msg.payload.protocol == "MORITZ") {

				if (msg.payload.hasOwnProperty("data") && !msg.payload.data.hasOwnProperty("culfw")) {
					node.processMaxMsg({
						address: msg.payload.address,
						device: msg.payload.device
					}, msg.payload.data, send, done);
				}

			}
			else {
				if (msg["topic"] &&
					msg.topic === "list") {
					if (send) {
						let list = {};
						for (let name in node.devices) {
							if (name !== "hasOwnProperty" && name !== "getKeyByValue") {
								let id = name;
								if ("name" in node.devices[name]) {
									id += ` (${node.devices[name].name})`
								}
								list[id] = node.devices[name];
							}
						}
						send([{
							topic: "cul-max-controller-list",
							devices: list
						}, null])
					}
				}
				if (done) {
					done();
				}
			}
		});

		this.saveDevices = function (done) {
			if (node.saving) return;

			node.saving = true;
			fs.writeFile(node.address + SAVED_MAX_DEVICES, JSON.stringify(node.devices, null, "\t"), (err) => {
				node.saving = false;
				if (done) {
					done();
				}
			});
		}

		this.on("close", function (removed, done) {
			node.saveDevices(done);
		});

	}

	RED.nodes.registerType("cul-max-controller", CULMaxControllerNode);

	//
	// DISCOVER controller
	RED.httpAdmin.get('/cul-max/controllers', function (req, res, next) {
		var controllerList = [];
		for (var controllerId in self.controllers) {
			if (controllerId != "getKeyByValue") {
				controllerList.push({
					id: controllerId,
					type: self.controllers[controllerId].type,
					name: self.controllers[controllerId].name,
					address: self.controllers[controllerId].address,
				})
			}
		}
		res.end(JSON.stringify(controllerList));
	});

	//
	// DISCOVER devices
	RED.httpAdmin.get('/cul-max/devices', function (req, res, next) {
		console.log("/cul-max/devices req.query.controllerConfig:" + req.query.controllerId);
		if (self.controllers[req.query.controllerId]) {
			var devices = [];
			for (var deviceId in self.controllers[req.query.controllerId].devices) {
				if (deviceId !== "getKeyByValue") {
					if (!req.query.type ||
						(self.controllers[req.query.controllerId].devices[deviceId].device && req.query.type == self.controllers[req.query.controllerId].devices[deviceId].device))
						if (deviceId !== "000000" && deviceId !== self.controllers[req.query.controllerId].address) {
							devices.push({
								address: deviceId,
								device: self.controllers[req.query.controllerId].devices[deviceId].device,
								name: self.controllers[req.query.controllerId].devices[deviceId].name
							})
						}
				}
			}
			res.end(JSON.stringify(devices));
		}
		else {
			res.send(500).send("CUL-MAX Controller not found");
		}
	});

	RED.httpAdmin.get('/cul-max/pairMode', function (req, res, next) {
		if (self.controllers[req.query.controllerId]) {
			res.end(self.controllers[req.query.controllerId].getInPairMode() ? "1" : "0");
		}
		else {
			res.status(500).send("CUL-MAX Controller not found");
		}
	});

	RED.httpAdmin.post('/cul-max/pairMode', function (req, res, next) {
		if (self.controllers[req.body.controllerId]) {
			self.controllers[req.body.controllerId].setInPairMode(req.body.pairMode == "true");
			res.end("ok");
		}
		else {
			res.status(500).send("CUL-MAX Controller not found");
		}
	});

	RED.httpAdmin.post('/cul-max/setDeviceName', function (req, res, next) {
		let controllerId = req.body.controllerId;
		let deviceId = req.body.deviceId;
		let name = req.body.name;
		if (self.controllers[controllerId]) {
			console.log(`setDeviceName: controllerId: ${controllerId}, deviceId: ${deviceId}, name: ${name}`);
			console.log(`controller: ${self.controllers[controllerId].name}`)
			if ("devices" in self.controllers[controllerId]) {
				if (self.controllers[controllerId].devices[deviceId]) {
					self.controllers[controllerId].devices[deviceId].name = name;
					self.controllers[controllerId].saveDevices(() => {
						res.end("ok");
					})
				}
				else {
					res.status(500).send("CUL-MAX device not found");
				}
			}
			else {
				res.status(500).send("CUL-MAX no devices");
			}
		}
		else {
			res.status(500).send("CUL-MAX Controller not found");
		}
	});

	RED.httpAdmin.post('/cul-max/removeDevice', function (req, res, next) {
		let controllerId = req.body.controllerId;
		let deviceId = req.body.deviceId;

		if (self.controllers[controllerId]) {
			console.log(`removeDevice: controllerId: ${controllerId}, deviceId: ${deviceId}`);
			if ("devices" in self.controllers[controllerId]) {
				if (self.controllers[controllerId].devices[deviceId]) {
					delete self.controllers[controllerId].devices[deviceId];
					if (self.controllers[controllerId].receivingDevices[deviceId]) {
						delete self.controllers[controllerId].receivingDevices[deviceId];
					}
					self.controllers[controllerId].updateStatus();
					self.controllers[controllerId].saveDevices(() => {
						res.end("ok");
					})
				}
				else {
					res.status(500).send("CUL-MAX device not found");
				}
			}
			else {
				res.status(500).send("CUL-MAX no devices");
			}
		}
		else {
			res.status(500).send("CUL-MAX Controller not found");
		}
	});

	console.log("Yup cul-max-controller");

}
