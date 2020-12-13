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
	"payload"
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

		node.addMaxDevice = function(deviceDetails) {
			if (deviceDetails["address"]) {
				if (!node.devices[deviceDetails.address]) {
					// add device
					node.devices[deviceDetails.address] = {
						device: deviceDetails.device
					}
				}
			}
			try {
				if (deviceDetails["data"] && deviceDetails.data["dst"]) {
					if (!node.devices[deviceDetails.data.dst]) {
						node.devices[deviceDetails.data.dst] = {
							device: deviceDetails.data.dstDevice
						}
					}

					for(var field in deviceDetails.data) {
						if (!IGNORE_FIELDS.includes(field)) {
							node.devices[deviceDetails.data.dst][field] = deviceDetails.data[field];
						}
					}
				}
			}
			catch(err) {
				node.log("!!ERROR:"+err);
			}

			node.updateStatus()

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
				node.addMaxDevice(msg.payload);

				send(msg);
		
			}

			if (done) {
				done();
			}
		});

		this.on("close", function (removed, done) {
			fs.writeFile(node.address+SAVED_MAX_DEVICES, JSON.stringify(node.devices,null,"\t"), (err) => {
				if (done) {
					done();
				}
			});
		});

	}

	RED.nodes.registerType("cul-max-controller", CULMaxControllerNode);
}
