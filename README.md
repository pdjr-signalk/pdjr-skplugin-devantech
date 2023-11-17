# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
DS range of general-purpose relay modules.

## Description

**pdjr-skplugin-devantech** implements an interface for Devantech
DS series Ethernet relay devices.
Products in the DS range provide eight switch input channels and
between four and 32 relay output channels dependent upon model.
The plugin presents a single DS series device as a pair of Signal K
switchbanks: one reporting switch inputs and another reporting and
controlling relay outputs.

The plugin listens on a specified TCP port for status reports from
configured DS devices and uses the received data to update Signal K
switchbank paths associated with the transmitting device.

Receipt of status notifications from a DS device causes the plugin to
establish and maintain a persistent TCP connection to the remote
device allowing operation of remote relays in response to Signal K PUT
requests on the associated relay switchbank channels.

This operating strategy is resilient to network outage and allows
*ad-hoc* connection of DS devices.

In addition to switchbank monitoring and control the plugin also
provides a mechanism for decorating associated switchbank paths with
automatically generated and user supplied metadata.

## Configuration

### Preparing a DS module for use with this plugin

Refer to the DS device user manual for details on how to install the
device, then use the ```_config.htm``` dashboard to make the following
configuration.

<dl>
  <dt>Network</dt>
  <dd>
    <p>
    Assign the DS device a static IP address on your LAN and specify a
    control port number.
    Make sure that the control port number you choose is not blocked by
    any firewalls on your Signal K host and/or network router.
    </p>
  </dd>
  <dt>Relays</dt>
  <dd>
    <p>
    Set 'Relay Name' if you wish.
    Set 'Pulse/Follow' to ```0```.
    Set 'Power-up Restore' to suit your needs.
    Set all other fields to blank.
    </p>
  </dd>
  <dt>Input/Output</dt>
  <dd>
    <p>
    For all I/O channels.
    Set 'Name' if you wish.
    Set 'Type' to ```Digital With Pullup```.
    Set 'Attached Relay Number' to ```None```.
    </p>
  </dd>
  <dt>Event Notifications</dt>
  <dd>
    <p>
    'Triggers' should be set to monitor events on the switch inputs and
    relay outputs supported by the DS device and also the virtual relay
    R32.
    For a four-relay DS device the trigger value will be
    ```{D1|D2|D3|D4|D5|D6|D7|D8|R1|R2|R3|R4|R32}```.
    </p>
    <p>
    'Target IP' should be set to the IP address of the Signal K host.
    </p>
    <p>
    'Target Port' should be set to some preferred value.
    Make sure any firewalls in your environment do not block your chosen
    port.
    </p>
    <p>
    'TCP/IP Timeout' should be set to 100.
    </p>
  </dd>
  <dt>Timers</dt>
  <dd>
    <p>
    Select 'Counter No.' 1 and set 'Counter Input' to ```T1``` and
    'Reset Input' to ```C1>9```.
    </p>
  </dd>
  <dt>Relays</dt>
  <dd>
    <p>
    Select 'Relay No' 32 and set 'Pulse/Follow' to ```C1>4```.
    </p>
  </dd>
</dl>

Steps (2) will ensure that an event notification message is sent to the
plugin immediately a switch input or relay output on the DS device
changes state.

Steps (3) and (4) toggle virtual relay R32 every five seconds ensuring
a regular 'heartbeat' status update.

### Plugin configuration

The plugin configuration has the following properties.

| Property name          | Value type | Value default | Description |
| :--------------------- | :---------- | :----------- | :---------- |
| modules                | Array       | (none)       | Collection of *module* objects. |
| statusListenerPort     | Number      | 24281        | The TCP port on which the plugin will listen for DS event notificataions. |
| transmitQueueHeartbeat | Number      | 25           | Transmit queue processing interval in milliseconds. |
| devices                | Array       | (see below)  | Collection of *device* objects.|

Each *module* object in the *modules* array defines a Devantech DS
device that will be controlled by the plugin.
Most installations will only need to specify entries in this array,
leaving other properties to assume their defaults.

The *devices* array can be used to introduce new operating commands
for particular Devantech relay devices.
The plugin includes a definition with the id 'DS' for operating a
device using the DS ASCII protocol.

Each *module* object has the following properties.

| Property name      | Value type | Value default | Description |
| :----------------- | :--------- | :------------ | :---------- |
| id                 | String     | (none)        | Unique identifier that will be used as the 'bank' part of the Signal K switch path used to identify thus module's switch channels. |
| cstring            | String     | (none)        | Connection specification of the form '*address*:*port*' that gives the IP address of the physical device implementing this module and the TCP port number on which it listens for commands. |
| channels           | Array      | (none)        | Array of *channel* objects. |
| description        | String     | ''            | Text for the meta data 'description' property that will be associated with the Signal K switch bank *id*. |
| deviceid           | String     | 'DS'          | Id of the *device* defining the operating characteristics of this module. |

Each *channel* object has the following properties.

| Property name | Value type | Value default | Description |
| :----------   | :--------- | :------------ | :---------- |
| index         | Number     | (none)        | Identifier that will be used as the 'channel' part of the Signal K switch path used to identify this relay. Signal K convention starts channel numbering at 1. |
| address       | Number     | *index*       | Address of the physical channel on the remote device with which this channel is associated. |
| description   | String     | ''            | Text for the meta data 'description' property that will be associated with this channel in Signal K. |

My test configuration for a DS2824 looks like this:
```
{
  "enabled": true,
  "enableDebug": true,
  "configuration": {
    "modules": [
      {
        "id": "DS2824",
        "description": "DS2824 Test Module",
        "deviceid": "DS",
        "cstring": "192.168.1.145:17123",
        "channels": [
          { "index": 1, "description": "Relay 1" },
          { "index": 2, "description": "Relay 2" },
          { "index": 3, "description": "Relay 3" },
          { "index": 4, "description": "Relay 4" },
          { "index": 5, "description": "Relay 5" },
          { "index": 6, "description": "Relay 6" },
          { "index": 7, "description": "Relay 7" },
          { "index": 8, "description": "Relay 8" }
        ]
      }
    ]
  }
}
```

### Device definitions

A *devices* array property can be included at the top-level of the
plugin configuration to add relay device definitions to those which are
pre-defined in the plugin or to override the existing 'DS' definition.
Each item in the 'devices' array is a *device* definition object which
describes the physical and interfacing characteristics of a supported
relay device.

The plugin includes this device definition suitable for DS-series relay
modules:
```
{
  "id": "DS",
  "channels": [
    {
      "address": 0,
      "oncommand": "SR {c} ON",
      "offcommand": "SR {c} OFF"
    }
  ]
}
```
Each device definition has the following properties.

| Property name | Value type | Value default | Description |
| :------------ | :--------- | :------------ | :---------- |
| id            | String     | (none)        | Space-separated list of identifiers, one for each of the relay devices to which the definition applies. Typically these identifiers should be the model number or model group name assigned by the device manufacturer. |
| channels      | Array      | (none)        | Array of *channel* definitions each of which specifies the commands required to operate a particular relay on the device being defined. |

Relays are identified by an ordinal *address* in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake channel with address 0 that will be elaborated for each of the
real channels on the device.

Each channel definition has the following properties.

| Property name | Value type | Value default | Description |
| :------------ | ---------- | :------------ | :---------- |
| address       | Number     | (none)        | Physical address of the relay that is being defined (or 0 for a generic definition). |
| oncommand     | String     | (none)        | Command that should be transmitted to the device to turn relay ON. |
| offcommand    | String     | (none)        | Command that should be transmitted to the device to turn relay OFF. |

Both *oncommand* and *offcommand* can contain embedded JSON escape
sequences.
Additionally, the following wildcard tokens will be substituted
with appropriate values before string transmission.

| Token | Replacement value |
| :---- | :---------------- |
| {c}   | The ASCII encoded address of the channel being processed. |
| {C}   | The binary encoded address of the channel being processed. |

## Operation

The plugin will start immediately it is installed but must be configured
with at least one 'module' definition before it can do something useful.

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
