


/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

var util = require('util');
var Cul = require('cul');
const fs = require('fs');
const path = require('path');

const cmd2MsgId = {
	"SetTemperature": "40"
}

function prefix(inStr, char, len) {
	var result = inStr;
	while(result.length < len) {
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
		this.minvalve = config.minvalve;
		var node = this;

		if (node.controller && node.controller.addReceivingDevice) {
			node.controller.addReceivingDevice(node);
		}

		this.on("close", function () {
			node.controller && node.controller.removeReceivingDevice && node.controller.removeReceivingDevice(node);
		});

		node.updateStatus = function() {
			var newText = "";
			switch (node.device.device) {
				case "HeatingThermostat":
					newText += `Valve: ${node.device.valveposition !== undefined ?  node.device.valveposition : "-"}% - `;
				case "WallMountedThermostat":
					newText += `${node.device.measuredTemperature || "-"}°C/${node.device.desiredTemperature || "-"}°C, Battery: ${node.device.battery}`
					break;
				case "ShutterContact":
					newText += `State: ${node.device.isopen == 1 ? "Open" : "Closed"}, Battery: ${node.device.battery}`
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
                    topic:"cul-max-thermostat:"+node.address,
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
		this.setTemperature = function(payload, send, done) {
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
				culMaxPayload = prefix(bits.toString(16),'0',2);
				node.controller.emit("sendTo", node.address, cmd2MsgId["SetTemperature"], culMaxPayload);
			}
			if (done) {
				done();
			}
		}

		this.on("input", function (msg, send, done) {
			send = send || function() { node.send.apply(node,arguments) };
			if (msg && msg.hasOwnProperty("topic")) {
				switch (msg.topic) {
					case "SetTemperature":
						let device = node.controller.getDevice(node.address);
						if (device !== null && device.device == "HeatingThermostat" || device.device == "WallMountedThermostat") {
							node.setTemperature(msg.payload, send, done);
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
    console.log("Yup cul-max-thermostat");
    
}
