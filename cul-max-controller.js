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

		node.addMaxDevice = function(deviceDetails, send, done) {
			var now = (new Date()).getTime() / 1000;

			if (deviceDetails["data"] && deviceDetails.data["msgType"]) {

				if (deviceDetails.data["src"]) {
					if (!node.devices[deviceDetails.data.src]) {
						node.devices[deviceDetails.data.src] = {
							device: deviceDetails.device,
							linkedDevices: []
						}
					}
				}

				if (deviceDetails.data["dst"]) {
					if (!node.devices[deviceDetails.data.dst]) {
						node.devices[deviceDetails.data.dst] = {
							device: deviceDetails.data.dstDevice,
							linkedDevices: []
						}
					}
				}

				if (deviceDetails.data["src"] && deviceDetails.data["dst"]) {
					if (!node.devices[deviceDetails.data["src"]].linkedDevices.includes(deviceDetails.data["dst"]))
						node.devices[deviceDetails.data["src"]].linkedDevices.push(deviceDetails.data["dst"]);
					
					if (!node.devices[deviceDetails.data["dst"]].linkedDevices.includes(deviceDetails.data["src"]))
						node.devices[deviceDetails.data["dst"]].linkedDevices.push(deviceDetails.data["src"]);
				}

				var direction = (deviceDetails.data.msgType.indexOf("State") == -1) ? "dst" : "src";

				if (deviceDetails.data[direction]) {
					for(var field in deviceDetails.data) {
						if (!IGNORE_FIELDS.includes(field)) {
							switch (field) {
								case "measuredTemperature":
								case "valveposition":
									if (node.devices[deviceDetails.data[direction]][field]) {
										let previousValue = node.devices[deviceDetails.data[direction]][field];
										let currentValue = deviceDetails.data[field];
										let valueDiff = currentValue - previousValue;
										let timeDiff = now - node.devices[deviceDetails.data[direction]].timestamp;
										let speed = valueDiff / timeDiff;
										node.devices[deviceDetails.data[direction]][field+"-diff"] = valueDiff;
										node.devices[deviceDetails.data[direction]][field+"-speed"] = speed;
									}
									break;
								case "msgType":
									if (deviceDetails.data[field] == "WallThermostatControl") {
										if (node.devices[deviceDetails.data[direction]]["device"] == undefined) {
											node.devices[deviceDetails.data[direction]].device = "HeatingThermostat";
										}	
									}
									break;
							}
							node.devices[deviceDetails.data[direction]][field] = deviceDetails.data[field];
						}
					}
					node.devices[deviceDetails.data[direction]].timestamp = now;
					send({
						topic: "cul-max:message",
						address: deviceDetails.data[direction],
						payload: node.devices[deviceDetails.data[direction]]
					});
				}
		
			}

			node.updateStatus();

			node.saveDevices(done);

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

				msg.topic = 'cul-max:message';
				node.addMaxDevice(msg.payload, send, done);

			}
			else {
				if (done) {
					done();
				}
			}
		});

		this.saveDevices = function(done) {
			fs.writeFile(node.address+SAVED_MAX_DEVICES, JSON.stringify(node.devices,null,"\t"), (err) => {
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
}
