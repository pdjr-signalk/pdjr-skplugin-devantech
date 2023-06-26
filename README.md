# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
range of general-purpose relay modules.

## Background

I have a number of remote domestic switching requirements on my boat
that either don't warrant the expense of NMEA 2000 hardware or are in
locations that are difficult to reach from the installed NMEA bus.

The UK supplier Devantech manufactures the DS range of wireless and
wired Ethernet relay modules that I felt could serve as N2K switchbank
alternatives in some situations.

This plugin integrates support for Devantech DS devices into Signal K.

Devantech Ltd\
Maurice Gaymer Road\
Attleborough\
NR17 2QZ\
England

Telephone: +44 (0)1953 457387\
Fax: +44 (0)1953 459793

Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

## Description

This plugin implements a control interface for the multi-channel
'DS series' Ethernet relay devices manufactured by the UK company
Devantech.
DS devices can be configured in a way which allows them to issue
event notifications on relay state change and also at timed intervals
and together these features allow DS devices to echo the familiar
behaviour of standard NMEA complient switchbanks whilst operating
over an Ethernet TCP connection.

DS devices which are to be used with the plugin must have a 'module'
entry in the plugin configuration which specifies their configured IP
address and control port.

The plugin listens on a specified TCP 'status' port for incoming
event notifications from configured devices.
The module status information supplied in received notifications is
used to update Signal K switch paths associated with the transmitting
DS device states so that they reflect reported relay states.

Receipt of notifications from a DS device causes the plugin to naintain
a TCP 'command' connection to the device which supports remote relay
operation through PUT requests on associated Signal K paths.

This control mechanism is resilient to network outage and allows ad-hoc
connection of DS devices.

In the Signal K context the plugin offers two distinct services.

Firstly, it provides a mechanism for decorating Signal K's data
hierarchy with user supplied meta-data that documents a relay module
in a meaningful way and allows relay channels to be described in
terms of their function or application.

Secondly, the plugin installs a PUT handler on each Signal K switch
path that is associated with a relay device channel.
The PUT handler translates state change requests directed at a switch
path into relay device operating commands.

## Configuration

### Configuring a DS module for use with this plugin

1. If not already done, configure the DS device's IP address and
   control port number. Make a note of these values so that they can be
   used in the 'cstring' property of the module's plugin configuration
   entry.

2. Event Notifications. 'Triggers' should identify all the relays on
   the device and host also the virtual relay R32. 'Target IP' should
   be set to the IP address of the Signal K host and 'Target Port' to
   the same value as the 'statusListenerPort' property in the plugin
   configuration. Set 'TCP/IP Timeout' to 5000.

3. Timers. Select 'Counter No.' 1 and set 'Counter Input' to 'T1' and
   'Reset Input' to 'C1>9'.

4. Relays. Select 'Relay No' 32 and set 'Pulse/Follow' to 'C1>4'.

These settings will ensure that an event notification message is sent
to the plugin whenever a physical relay changes state and at least once
every five seconds.

### Plugin configuration

The plugin configuration has the following properties.

| Property           | Default | Description |
| :----------------- | :------ | :---------- |
| statusListenerPort | 24281   | Required TCP port number on which the plugin will listen for DS event notificataions. |
| modules            | []      | Required array property consisting of a collection of 'module' object properties each of which describes a particular relay device you wish the plugin to operate. |
| devices            | (none)  | Optional array property consisting of a collection of 'device' objects each of which defines the operating characteristics of a Devantech product. The plugin includes a single definition suitable for all Devantech DS devices. |

Each 'module' object has the following properties.

| Property           | Default | Description |
| :----------------- | :------ | :---------- |
| id                 | (none)  | Required string property supplying a unique Signal K identifier for the module being defined. This value will be used as part of the Signal K path used to identify each relay switch channel. |
| description        | (none)  | Optional string property can be used to supply some documentary text about the module. |
| size               | (none)  | Required number property specifying the number of relay channels supported by the device. |
| deviceid           | 'DS'    | Required string property specifying the physical device to which this module definition relates. The value supplied here must be one of the device 'id's defined in the 'devices' section (see below). |
| cstring            | (none)  | Required string property supplying a connection string of the form '*address*:*port*' that identifes the physical device implementing this module and the TCP port number on which it listens for commands. |
| channels           | []      | Array property containing a collection of *channel* definitions each of which describes one of the module's relay bank channels. |

Each *channel* object in the *channels* array has the following
properties.

| Property    | Default | Description |
| :---------- | ------- | :---------- |
| index       | (none)  | Required number property specifying the Signal K index of the module channel being defined (Signal K convention starts channel numbering at 1).  This value will be used as part of the Signal K path used to identify each relay switch channel. |
| address     | (none)  | Optional number property specifying the address of the physical channel on the remote device with which this channel is associated. If this property is omitted, then the plugin will use the value of the
'index' property as the channel address. |
| description | (none)  | Optional string property supplying some text for the meta data 'description' property that will be associated with the channel in Signal K. |

### Device definitions

A 'devices' array property can be included at the top-level of the
plugin configuration to add relay device definitions to those which are
pre-defined in the plugin or to override an existing definition.
Each item in the 'devices' array is a *device* definition object which
describes the physical and interfacing characteristics of a supported
relay device.

A device must be defined here before it can be configured for use in a
module definition.
The plugin includes a single device definition suitable for all
DS-series Devantech relay modules that were available at the time of
release:
```
{
  "id": "DS",
  "statuscommand": "ST",
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

| Property      | Default | Description |
| :------------ | ------- | :---------- |
| id            | (none)  | Required string property supplying a space-separated list of identifiers, one
for each of the relay devices to which the definition applies. Typically these identifiers should be the model number assigned by the
device manufacturer. |
| statuscommand | (none)  | String property supplying the string that must be transmitted to the device to elicit a status report. |
| channels            | []      | Array property introduces a list of *channel* definitions each of which specifies the commands required to operate a particular relay on the device being defined. |

Relays are identified by an ordinal address in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake, generic, channel with address 0 and this will be elaborated
for each of the real channels on the device.

Each channel definition has the following properties.

| Property            | Default | Description |
| :------------------ | ------- | :---------- |
| index               | (none)  | Number property giving the ordinal number of the relay channel that is being defined (or 0 for a generic definition). |
| oncommand           | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' ON. |
| offcommand          | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' OFF. |

Both 'oncommand' and 'offcommand' can contain embedded JSON escape
sequences.
Additionally, the following wildcard tokens will be substituted
with appropriate values before string transmission.

| Token | Replacement value |
| :---- | :---------------- |
| {c}   | The ASCII encoded address of the channel being processed. |
| {C}   | The binary encoded address of the channel being processed. |
| {A}   | The value of any defined authentication token. |
| {p}   | The value of any defined module password. |

## Operation

The plugin will start immediately it is installed but must be
configured before use.
At startup the module writes a list of supported device identifiers
to the Signal K log.

Support for status reportind across the Devantec range is not
consistently implemented and the plugin seeks to manage this issue
by requiring that supported devices must (i) report all module relay
states immediately a relay operation has completed, and (ii)
provide a mechanism for ad-hoc interrogation of module status.

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
