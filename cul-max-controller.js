/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

var util = require('util');
var Cul = require('cul');
const fs = require('fs');
const path = require('path');
const { deflateRawSync } = require('zlib');

const SAVED_MAX_DEVICES = "_saved_max_devices.json";

const IGNORE_FIELDS = [
	"len",
	"src",
	"dst",
	"dstDevice",
	"payload",
	"getKeyByValue"
]

function prefix(inStr, char, len) {
	var result = inStr;
	while(result.length < len) {
		result = char + result;
	}
	return result;
}

let msgCounter = 0;
function nextMsgCounter() {
	msgCounter = (msgCounter + 1) & 0xFF;
	return prefix(msgCounter.toString(16),'0',2);
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

		if(!self.controllers) {
			self.controllers = {};
		}
		self.controllers[this.id] = this;

		this.devices = {};

		node.getDevice = function(address) {
			if (node.devices[address]) {
				return node.devices[address];
			}
			return null;
		}

		node.on("sendTo", function(address, cmd, payload) {
			// Z 0B 1F 00 40 123456 0E14C1 00 65 05
			let packet = {
				msgCnt: nextMsgCounter(),
				msgFlag: "00",
				msgType: cmd,
				src: node.address,
				dst: address,
				groupId: "00",
				payload: payload,
				toString: function() {
					return (this.msgCnt+this.msgFlag+this.msgType+this.src+this.dst+this.groupId+this.payload).toUpperCase();
				}
			};

			let packetStr = packet.toString();
			let len = prefix((packetStr.length/2).toString(16),'0',2).toUpperCase();
			packetStr = "Zs" + len + packetStr;
			node.log("sendTo packet:"+packetStr+"|");
			node.send([null, {
				topic: "raw",
				payload: packetStr
			}])
		});

		node.updateStatus = function() {
			let count = 0;
			for (var address in node.devices) {
				count++;
			}

			node.status({
				fill: "green",
				shape: "dot",
				text: `${count} devices`
			});

		}

		node.loadDevices = function(data) {
			for(var address in data) {
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

		console.log("CUL-MAX-Controller file:"+this.address+SAVED_MAX_DEVICES);

		// Load any saved max devices
		fs.stat(this.address+SAVED_MAX_DEVICES, (err,stats) => {
			if (!err) {
				if (stats.isFile()) {
					node.status({
						fill: "green",
						shape: "ring",
						text: "Loading saved devices"
					});
					fs.readFile(node.address+SAVED_MAX_DEVICES,(err, data) => {
						if (err) {
							node.updateStatus();
							return;
						}
						try {
							node.loadDevices(JSON.parse(data.toString()));
						}
						catch(err) {
							node.log(`Error loading data from file ${node.address+SAVED_MAX_DEVICES}. Error:${err}`)
						}
					})
				}
			}
		});

		node.processMaxMsg = function(device, data, send, done) {
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
				node.log(`Adding name '${node.receivingDevices[device.address].name}' to address '${device.address}'`)
				node.devices[device.address].name =node.receivingDevices[device.address].name;
			}

			if (data) {
				for(let field in data) {
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
									newData["controlpoints-"+data.weekday] = data.controlpoints;
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
										node.devices[device.address][field+"-prev"] = previousValue;
										let currentValue = data[field];
										let valueDiff = currentValue - previousValue;
										let timeDiff = now - (node.devices[device.address][field+"-timestamp"] || now);
										let speed = valueDiff / timeDiff;
										if (isNaN(speed)) {
											speed = 0;
										}
										node.devices[device.address][field+"-diff"] = valueDiff;
										node.devices[device.address][field+"-speed"] = speed;
										node.devices[device.address][field+"-timestamp"] = now;
									}
									break;
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
						let tempIncrease = (node.devices[device.address]["measuredTemperature-speed"] * (5*60)); //Increase of temp in 5 minutes.
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

				let globalNeedHeating = node.context().global.get("needHeating");
				if (!globalNeedHeating) {
					globalNeedHeating = {};
				}
				globalNeedHeating[device.address] = {
					tempNeedHeat: tempNeedHeat2,
					valveNeedHeat: valveNeedHeat
				}
				node.context().global.set("needHeating",globalNeedHeating);

				if (send) {
					send([{
						topic: "cul-max:message",
						address: device.address,
						payload: node.devices[device.address],
						needHeat:{
							tempNeedHeat: tempNeedHeat2,
							valveNeedHeat: valveNeedHeat
						}
					},null]);
				}

				if (node.receivingDevices[device.address]) {
					node.receivingDevices[device.address].emit("data",node.devices[device.address]);
				}
			}

			node.updateStatus();

			node.saveDevices(done);

		}

		this.addReceivingDevice = function (receiver) {
			node.receivingDevices[receiver.address] = receiver;
		}

		this.removeReceivingDevice = function(receiver) {
			if (node.receivingDevices[receiver.address]) {
				delete node.receivingDevices[receiver.address];
			}
		}

		/* ===== Node-Red events ===== */
		this.on("input", function (msg, send, done) {
			send = send || function() { node.send.apply(node,arguments) };

			//node.log("Msg for cul-max-controller:"+JSON.stringify(msg));
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
							send([{
								topic:"cul-max-controller-list",
								devices: node.devices
							},null])
						}
					} 
				if (done) {
					done();
				}
			}
		});

		this.saveDevices = function(done) {
			if (node.saving) return;

			node.saving = true;
			fs.writeFile(node.address+SAVED_MAX_DEVICES, JSON.stringify(node.devices,null,"\t"), (err) => {
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
	RED.httpAdmin.get('/cul-max/controllers', function(req, res, next)
	{
		var controllerList = [];
		for(var controllerId in self.controllers) {
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
	RED.httpAdmin.get('/cul-max/devices', function(req, res, next)
	{
		console.log("/cul-max/devices req.query.controllerConfig:"+req.query.controllerId);
		if (self.controllers[req.query.controllerId]) {
			var devices = [];
			for(var deviceId in self.controllers[req.query.controllerId].devices) {
				if (deviceId !== "getKeyByValue") {
					if (!req.query.type || 
						(self.controllers[req.query.controllerId].devices[deviceId].device && req.query.type == self.controllers[req.query.controllerId].devices[deviceId].device))
					devices.push({
						address: deviceId,
						device: self.controllers[req.query.controllerId].devices[deviceId].device
					})	
				}
			}
			res.end(JSON.stringify(devices));
		}
		else {
			res.send(500).send("CUL-MAX Controller not found");
		}
	});

	console.log("Yup cul-max-controller");

}
