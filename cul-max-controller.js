/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

var util = require('util');
var Cul = require('cul');
const fs = require('fs');
const path = require('path');

const SAVED_MAX_DEVICES = "_saved_max_devices.json";

const IGNORE_FIELDS = [
	"len",
	"src",
	"dst",
	"dstDevice",
	"payload",
	"getKeyByValue"
]

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

		if(!self.controllers) {
			self.controllers = {};
		}
		self.controllers[this.id] = this;

		this.devices = {};

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
							node.processMaxMsg({
								address: data.dst,
								device: data.dstDevice
							});
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
									if (node.devices[device.address][field]) {
										let previousValue = node.devices[device.address][field];
										let currentValue = data[field];
										let valueDiff = currentValue - previousValue;
										let timeDiff = now - node.devices[device.address][field+"-timestamp"];
										let speed = valueDiff / timeDiff;
										node.devices[device.address][field+"-diff"] = valueDiff;
										node.devices[device.address][field+"-speed"] = speed;
										node.devices[device.address][field+"-timestamp"] = now;
									}
									break;
							}

							node.devices[device.address][field] = data[field];
							break;
					}
				}

				send({
					topic: "cul-max:message",
					address: device.address,
					payload: node.devices[device.address]
				});

				if (node.receivingDevices[device.address]) {
					node.receivingDevices[device.address].emit("data",node.devices[device.address]);
				}
			}

			node.updateStatus();

			node.saveDevices(done);

		}

		this.receivingDevices = {};
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

			node.log("Msg for cul-max-controller:"+JSON.stringify(msg));
			if (msg["topic"] && 
				msg.topic === "cul:message" && 
				msg["payload"] && 
				msg.payload["protocol"] && 
				msg.payload.protocol == "MORITZ") {

				node.processMaxMsg({
					address: msg.payload.address,
					device: msg.payload.device
				}, msg.payload.data, send, done);

			}
			else {
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
