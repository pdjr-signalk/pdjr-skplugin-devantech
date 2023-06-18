# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
DS range of general-purpose Ethernet relay modules.

## Background

I have a number of remote domestic switching requirements on my boat
that don't warrant the expense of NMEA 2000 hardware and/or are not
easily serviced by the installed NMEA bus.

When Devantech released their DS series of wireless and wired Ethernet
relay modules they kindly supplied a prototype device which allowed
the development of this plugin.

Out of the box, the Devantech devices are somewhat limited in their
status reporting capability and the plugin includes a firmware
tweak that improves this issue.

Devantech Ltd\
Maurice Gaymer Road\
Attleborough\
NR17 2QZ\
England

Telephone: +44 (0)1953 457387\
Fax: +44 (0)1953 459793

Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

## Description

This plugin implements a control interface for the DS series of
multi-channel relay modules manufactured by the UK company
Devantech.
This range includes devices that interface over WiFi and wired
Ethernet.

The plugin offers two distinct services.

Firstly, it provides a mechanism for decorating Signal K's data
hierarchy with user supplied meta-data that documents a relay module
in a meaningful way and allows relay channels to be described in
terms of their function or application.

Secondly, the plugin installs a handler on each defined Signal K relay
output channel that translates state change requests into relay module
operating commands.

The plugin uses the Devantec module's TCP ASCII module operating mode.

## Configuration

If you intend using a Devantech relay module from the DS range then
you must patch your device firmware and then configure your device on
its host Ethernet network before attempting to use it with this plugin.

### Configuring a DS module

This plugin includes a patch for the firmware of DS series Devantech
relay modules which adds two new commands to the TCP ASCII control
groups.

Why is the patch necessary and what does it do? The TCP ASCII interface
to Devantech modules is not all that useful for real-time applications
that need accurate, up-to-date, status information about the remote
device.

In particular, the module's respond to a relay operation command with
the message "Ok".
Exactly what this means is unfathomable.

Additionally, there is no command which reports as a response the
current status of the module (i.e. what the state of every relay is
at that moment in time).

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
| description        | (none)  | Optional string property can be used to supply some documentary text about the module. |
| deviceid           | (none)  | Required string property specifying the type of physical device to which this module definition relates. The value supplied here must be one of the 'deviceis's defined in the 'devices' section (see below). |
| cstring            | (none)  | Required string property supplying a connection string that tells the plugin how to connect to the physical device implementing the module. |
| channels           | []      | Array property containing a collection of *channel* definitions each of which describes one of the module's relay bank channels. |

There are two styles of 'cstring' property value: one describes USB
connection and the other an ethernet connection (supporting both wired
and wireless devices).

A USB connection string has the form '*device-path*' where
*device-path* specifies the operating system serial device to which the
associated physical device is connected.
A typical value for a USB 'devicecstring' might be
'usb:/dev/ttyACM0'.

An ethernet connection string has the form   '[*password*@]*address*:*port*'
where *address* is the IP address or hostname assigned to the
associated device  and *port* is the port number on which the device
provides service.
*password* is an optional password required to operate the device.
A typical value for an ethernet 'devicecstring' might be
'eth:letmein@192.168.0.20:14555'.
The values you should use when constructing this string are defined
when you configure a Devantech ETH or WIFI relay device for first use:
consult your user Devantech user guide for more information.

Each *channel* object in the *channels* array has the following
properties.

| Property    | Default | Description |
| :---------- | ------- | :---------- |
| index       | (none)  | Required number property specifying the Signal K index of the module channel being defined (Signal K convention starts channel numbering at 1).  This value will be used as part of the Signal K path used to identify each relay switch channel. |
| address     | (none)  | Optional number property specifying the address of the physical channel on the remote device with which this channel is associated. If this property is omitted, then the plugin will use the value of the
'index' property as the channel address. Beware that channel addresses on Devantech devices may start at 0. |
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
modules that were usable in the Signal K context and that were available
at the time of release.
If you need to add an unsupported device, then read-on.

Each device definition has the following properties.

| Property    | Default | Description |
| :---------- | ------- | :---------- |
| id          | (none)  | Required string property supplying a space-separated list of identifiers, one
for each of the relay devices to which the definition applies. Typically these identifiers should be the model number assigned by the
device manufacturer. |
| size        | (none)  | Required number property specifying the number of relay channels supported by the device. |
| protocols   | []      | Array property introducing a list of 'protocol' objects each of which describes a communication protocol supported by the device (usually you will only need to specify one protocol). |

Each 'protocol' object has the following properties.

| Property            | Default | Description |
| :------------------ | ------- | :---------- |
| id                  | 'usb'   | Required string property specifying the protocol type being defined (must be one of 'usb' or 'tcp'). |
| statuscommand       | (none)  | String property supplying the string that must be transmitted to the device to elicit a status report. |
| statuslength        | 1       | Number property specifying the number of bytes in the status report message transmitted by the device in response to 'statuscommand'. |
| authenticationtoken | '{p}'   | String property specifying the format of the authentication token '{A}' which can be used when defining operating commands (see below). Some Devantech protocols require that a device password is decorated with some identifying character sequence and the format of that sequence can be specified here: typically this will include the token {p} which will be interpolated with the password value specified in the 'cstring' property discussed previously. |
| channels            | []      | Array property introduces a list of *channel* definitions each of which specifies the commands required to operate a particular relay on the device being defined. |

Relays are identified by an ordinal address in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake, generic, channel with address 0 and this will be elaborated
for each of the real channels on the device.

Each channel definition has the following properties.

| Property            | Default | Description |
| :------------------ | ------- | :---------- |
| address             | (none)  | Number property giving the ordinal number of the relay channel that is being defined (or 0 for a generic definition). |
| oncommand           | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' ON. |
| offcommand          | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' OFF. |
| statusmask          | (none)  | Number property introducing a value that will be bitwise AND-ed with status reports received from the device so as to obtain a state value for a channel. If no value is supplied then the plugin will compute a mask value from
the channel 'address' using the formula (1 << (*address* - 1)).

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

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
