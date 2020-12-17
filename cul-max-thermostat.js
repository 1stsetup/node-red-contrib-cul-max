


/**
 * Created by Michel Verbraak (info@1st-setup.nl).
 */

var util = require('util');
var Cul = require('cul');
const fs = require('fs');
const path = require('path');

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
		var node = this;

		if (node.controller && node.controller.addReceivingDevice) {
			node.controller.addReceivingDevice(node);
		}

		this.on("close", function () {
			node.controller && node.controller.removeReceivingDevice && node.controller.removeReceivingDevice(node);
		});

		this.devices = {};

        this.on("input", function (msg) {
			if (msg != null) {

			}
		});

        this.on("data", function (device) {
			if (device != null) {
                node.send({
                    topic:"cul-max-thermostat:"+node.address,
                    payload: device
                })
			}
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

        		// 		// Check if we want heating or not.
				// if (node.devices[device.address]["measuredTemperature-diff"] && node.devices[device.address]["desiredTemparature"]) {
				// 	// Calculate what the temperature will be in 5 minutes
					
				// }

		/* ===== Node-Red events ===== */
		this.on("input", function (msg, send, done) {
			send = send || function() { node.send.apply(node,arguments) };

            if (done) {
                done();
            }



        });

		this.on("close", function (removed, done) {
            if (done) {
                done();
            }
		});

	}

    RED.nodes.registerType("cul-max-thermostat", CULMaxThermostat);
    console.log("Yup cul-max-thermostat");
    
}
