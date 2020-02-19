### Conectric EKM Configuration Tool

This tool allows you to configure properties of EKM meters that are connected to a Conectric mesh network using Conectric's RS-485 devices.

At the moment the following functionality is supported:

* Set CT Ratio.

### Setup

This tool requires Node.js 8.9.4 or newer.  To nstall dependencies:

```
$ npm install
```

### Configuration File

This tool reads a JSON file to configure meters.  When using this tool with Conectric's gateway, you should setup the meter configurations that you require in the gateway's `meters.json` file ([read documentation](https://github.com/Conectric/node-gateway)).

### Configuring Meter CT Ratios

Once you have configured the `meters.json` file, run the tool to set the meter CT ratios as follows:

```
$ npm run setct </path/to>/meters.json
```

The tool will loop over each meter that has a CT ratio set in the `meters.json` file, and send the appropriate configuration commands to the meter.
