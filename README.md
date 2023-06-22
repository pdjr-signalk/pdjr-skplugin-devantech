# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
range of general-purpose relay modules.

## Background

I have a number of remote domestic switching requirements on my boat
that don't warrant the expense of NMEA 2000 hardware and/or are not
easily serviced by the installed NMEA bus.

The UK supplier Devantech manufactures a range of widely available
USB, wireless and wired Ethernet relay modules that I felt could serve
as N2K switchbank alternatives in some situations.

This plugin integrates support for Devantech devices into Signal K.

Devantech Ltd\
Maurice Gaymer Road\
Attleborough\
NR17 2QZ\
England

Telephone: +44 (0)1953 457387\
Fax: +44 (0)1953 459793

Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

## Description

This plugin implements a control interface for multi-channel relay
modules manufactured by the UK company Devantech, including devices
that interface over USB, WiFi and wired Ethernet.
The plugin includes specimen configurations for devices in Devantech's
USB, TCP and DS ranges and support for additional devices can be added
through module configuration. 

In the Signal K context the plugin offers two distinct services.

Firstly, it provides a mechanism for decorating Signal K's data
hierarchy with user supplied meta-data that documents a relay module
in a meaningful way and allows relay channels to be described in
terms of their function or application.

Secondly, the plugin installs on each defined Signal K relay output
channel a PUT handler that translates state change requests into relay
device operating commands.

Devantech modules are not consistent in providing confirmative
responses to relay operating commands and are somewhat inconsistent in
the ways in which they can be cajoled into reporting module status.
The plugin ensures that:

1. Every relay operation command immediately results in a device status
   report being received by Signal K (it is this status report that
   ultimately sets the state of Signal K's switch paths, not the
   receipt of a PUT command *per-se*).

2. Every 5 seconds a status report is requested from the remote device
   and this is similarly used to update the state of Signal K's switch
   paths.

## Configuration

If you intend using a Devantech relay module from the DS range then
you must patch your device firmware and then configure your device on
its host Ethernet network before attempting to use it with this plugin.

The include file 'ds.patch' adds two 

### Configuring a DS module

This plugin includes a patch for the firmware of DS series Devantech
relay modules which adds two new commands to the TCP ASCII control
groups.

Why is the patch necessary and what does it do? The TCP ASCII interface
to Devantech modules is not all that useful for real-time applications
that need accurate, up-to-date, status information about the remote
device.

In particular, the modules respond to a relay operation command with
the message "Ok".
Exactly what this means is unfathomable.

Additionally, there is no command which reports the current status of
the module (i.e. what the state of every relay is at that moment in
time).

The provided patch corrects this by:

1. Updating the module's SR (**S**et **R**elay) command so that it
   responds with the status of the module's relays.

2. Replacing the module's ST (**St**atus) command so that the module
   returns the status of the module's relays.

Install the patch using the firmware update mechanism described in the
Devantech user guide and then follow the set-up instructions by setting
up the device's IP address and port number.

### Plugin configuration

The plugin configuration has the following properties.

| Property   | Default | Description |
| :--------- | :------ | :---------- |
| modules    | []      | Required array property consisting of a collection of 'module' object properties each of which describes a particular relay device you wish the plugin to operate. |
| devices    | (none)  | Optional array property consisting of a collection of 'device' objects each of which defines the operating characteristics of a Devantech product. The plugin includes definitions for most Devantech devices currently in production, but additional devices can be specified here. |

Each 'module' object has the following properties.

| Property           | Default | Description |
| :----------------- | :------ | :---------- |
| id                 | (none)  | Required string property supplying a unique Signal K identifier for the module being defined. This value will be used as part of the Signal K path used to identify each relay switch channel. |
| size               | (none)  | Required number property specifying the number of relay channels supported by the device. |
| description        | (none)  | Optional string property can be used to supply some documentary text about the module. |
| deviceid           | (none)  | Required string property specifying the physical device to which this module definition relates. The value supplied here must be one of the device 'id's defined in the 'devices' section (see below). |
| cstring            | (none)  | Required string property supplying a connection string that tells the plugin how to connect to the physical device implementing the module. |
| channels           | []      | Array property containing a collection of *channel* definitions each of which describes one of the module's relay bank channels. |

There are two styles of 'cstring' property value: one describes a USB
connection and the other an Ethernet connection.

A USB connection string has the form '*device-path*' where
*device-path* specifies the operating system serial device to which the
associated physical device is connected.
A typical value for a USB 'devicecstring' might be '/dev/ttyACM0'.

An ethernet connection string has the form  '[*password*@]*address*:*port*'
where *address* is the IP address or hostname assigned to the
associated device and *port* is the port number on which the device
provides service.
*password* is an optional password required to operate the device.
A typical value for an ethernet 'devicecstring' might be
'letmein@192.168.0.20:14555'.
The values you should use when constructing this string are defined
when you configure a Devantech ETH or WIFI relay device for first use:
consult your Devantech user guide for more information.

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
The plugin installation includes device definitions for Devantech relay
modules that were usable in the Signal K context and that were
available at the time of release.
If you need to add an unsupported device, then read-on.

Each device definition has the following properties.

| Property      | Default | Description |
| :------------ | ------- | :---------- |
| id            | (none)  | Required string property supplying a space-separated list of identifiers, one
for each of the relay devices to which the definition applies. Typically these identifiers should be the model number assigned by the
device manufacturer. |
| series        | (none)  | One of 'eth', 'ds' or 'usb' specifying the product range which includes the devices being defined. |
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
