# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
range of general-purpose relay modules.

## Description 

This plugin implements a control interface for multi-channel relay
devices manufactured by the UK company Devantech and includes support
for devices that are operated over USB, WiFi and wired Ethernet.

This plugin offers two distinct services.

Firstly, it provides a mechanism for decorating Signal K's data
hierarchy with user supplied meta-data.
This allows relay devices to be documented in a meaningful way
(perhaps including the device location, product code, serial-number,
etc.) and relay channels to be described in terms of their function or
application.

Secondly, the plugin installs a PUT handler on each defined
relay output channel, supporting state change operations within Signal
K and allowing PUT operations on switch bank relay channels to be
translated into relay module operating commands which are sent to the
associated device.

Devantech Ltd kindly supported the development of this plugin by making
one of its relay devices available to the author for evaluation and
testing.

## Configuration

If you intend using a Devantech relay device from the ETH or WIFI
ranges then you must configure the device on your network before
attempting to use it with this plugin.


__pdjr-skplugin-devantech__ operates autonomously but must be configured
before use.

If you are using a relay module from Devantech, then most likely the
only configuration required will be to define the modules connected to
your system.

The plugin configuration has the following properties.

| Property   | Default                            | Description |
| :--------- | :--------------------------------- | :---------- |
| switchpath | 'electrical.switches.bank.{m}.{c}' | Required string property specifying a pattern for the Signal K
keys that will be used by the plugin to represent relay module channels. The default value can probably be left untouched, but if you need to change it, then any path you supply must include the tokens '{m}' and '{c}' as placeholders which the plugin will interpolate with appropriate 'moduleid' and 'channelid' property values. |
| modules    | []                                 | Required array property consisting of a collection of 'module' object properties each of which describes a particular relay device you wish the plugin to operate. |

Each 'module' object has the following properties.

| Property    | Default                            | Description |
| :---------- | :--------------------------------- | :---------- |
| id          | (none)                             | Required string property supplying a unique identifier for the module being defined. This value will be used as part of the Signal K path used to identify each relay channel (by replacing the '{m}' token in the 'switchpath' property discussed above) and will also be used in status and error messaging. |
| description | (none)                             | Optional string property can be used to supply some documentary text. |
| deviceid    | (none)                             | Required string  property specifying the device definition appropriate to the particular device that is being used to implement this module.
See the [Device definitions](#device-definitions) section below for
more detail.

__Module connection string__ [devicecstring]\
This required string value supplies a connection string that tells the
plugin how to connect to the physical device implementing this module.

There are two styles of value: one describes a USB connection and the
other an ethernet connection (supporting both wired and wireless
devices).

A USB connection string has the form '__usb:__*device-path*' where
*device-path* specifies the serial device representing the physical
port to which the associated device is connected.
A typical value for a USB __devicecstring__ might be 'usb:/dev/ttyACM0'.

An ethernet connection string has the form   '__eth:__[*password*__@__]*address*__:__*port*'
where *address* is the IP address or hostname assigned to the associated
device, *port* is the port number on which it provides service and
*password* is the optional password required to operate the device.
A typical value for an ethernet __devicecstring__ might be 'eth:letmein@192.168.0.20:14555'.
The values you should use when constructing this string are defined
when you configure a Devantech ETH or WIFI relay device for first use:
consult your user guide for more information. 

__Module channels__ [channels]\
This array property introduces a collection of *channel definitions* each
of which describes one of the module's a relay bank channels using the
following properties.

__Channel index__ [index]
This number property defines the relay module channel to which the channel
definition relates, supplying the value that Signal K will use to identify
the associated relay.
This value is used by the plugin to overwrite the '{c}' token in the
__switchpath__ property discussed earlier and is also used in status and
error reporting.

__Channel address__ [address]\
This optional number property defines the physical channel on the
remote device with which this channel is associated.
If this property is omitted, then the plugin will use the value of the
__index__ property as the channel address.
 
__Channel description__ [description]\
This optional string property supplies some narrative that is used to
decorate the associated Signal K key's meta property with information
that can be picked up by other Signal K processes.

__Device definitions__ [devices]\
This array property defines an array of *device definitions*, each of
which describes the physical and interfacing characteristics of a
supported relay device.

A device must be defined here before it can be configured for use in a
module definition.
The plugin installation includes device definitions for Devantech relay
modules that were usable in the Signal K context and that were available
at the time of release.
If you need to add an unsupported device, then read-on.

Each device definition has the following properties.

__Device ids__ [id]\
This string property supplies a list of space-separated identifiers, one
for each of the relay devices to which the definition applies.
Typically these identifiers should be the model number assigned by the
device manufacturer.

__Number of relay channels__ [size]\
This number property specifies the number of relay channels supported by
the device.

__Protocol definitions__ [protocols]\
This array property introduces a list of *protocol definitions* each of
which defines a communication protocol supported by the device (usually
you will only need to specify one protocol).
Each protocol definition has the following properties.

__Protocol id__ [id]\
This string property specifies the protocol type being defined and must
be one of 'usb' or 'tcp'.
The value defaults to 'usb'.

__Protocol status command__ [statuscommand]\
This string property supplies the string that must be transmitted to the
device to elicit a status report.

__Protocol status report length__ [statuslength]\
This number property specifies the number of bytes in the status report
message transmitted by the device in response to a status command.
The value defaults to 1.

__Protocol authentication token__ [authenticationtoken]\
This string property specifies the format for an authentication token
'{A}' which can be used when defining operating commands (see below).
Some Devantech protocols require that a device password is decorated
with some identifying character sequence and the format of that sequence
can be specified here: typically this will include the token {p} which
will be interpolated with the password value specified in the
[devicecstring] property discussed previously.
 
__Protocol channel commands__ [channels]\
This required array property introduces a list of *channel definitions*
each of which specifies the commands required to operate a particular
relay on the device being defined.
Relays are identified by an ordinal address in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake, generic, channel with address 0 and this will be elaborated
for each of the real channels on the device.

Each channel definition has the following properties.

__Channel address__ [address]\
This required number property gives the ordinal number of the relay
channel that is being defined (or 0 for a generic definition).

__Channel on command__ [oncommand]\
This required string property specifies the character sequence that
should be transmitted to the device to turn the relay identified by
[address] ON.

__Channel off command__ [offcommand]\
This required string  property specifies the character sequence that
should be transmitted to the device to turn the relay identified by
[address] OFF.

Both [oncommand] and [offcommand] can contain embedded JSON escape
sequences.
Additionally, the the following wildcard tokens will be substituted
with appropriate values before string transmission.

| Token | Replacement value |
|:------|:------------------|
| {c}   | The ASCII encoded address of the channel being processed. |
| {C}   | The binary encoded address of the channel being processed. |
| {A}   | The value of any defined authentication token. | 
| {p}   | The value of any defined module password. |

__Channel status mask__ [statusmask]\
This optional number property can be used to introduce a value that
will be bitwise AND-ed with state reports received from the device
so as to obtain a state value for a channel.
If no value is supplied then the plugin will compute a mask value from
the channel [address] using the formula (1 << (*address* - 1)).

## Supported relay modules

__pdjr-skplugin-devantech__ supports relay modules manufactured by:

Devantech Ltd\
Maurice Gaymer Road\
Attleborough\
NR17 2QZ\
England

Telephone: +44 (0)1953 457387\
Fax: +44 (0)1953 459793

Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

You can obtain a list of supported module ids by enabling the debug key
and reviewing the Signal K log.

## Debugging and logging

The plugin understands the 'devantech' debug key.

## Author

Paul Reeve <preeve@pdjr.eu>\
October 2020
