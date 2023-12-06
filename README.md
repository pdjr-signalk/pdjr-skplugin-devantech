# pdjr-skplugin-devantech

Signal K interface to
[Devantech](https://www.devantech.co.uk)
DS general-purpose relay modules.

## Description

**pdjr-skplugin-devantech** implements an interface to Devantech DS
series Ethernet relay devices.

DS devices provide a mix of general purpose analogue and digital I/O
and relay output channels: the number and type of channels varies
across the product range.

The plugin represents DS module channel states as a Signal K paths
of the form 'electrical.switches.bank.*address*.*index**type*.state'.
Where *address* is a representation of a DS module's IP address;
*index* is the ordinal number of a channel on the DS module and
*type* is either 'R' or 'S' to indicate whether the path represents
the state of a relay output or a switch input.

The plugin listens on a user-configured TCP port for status reports
from DS devices and uses the received data to update the state of
switchbank paths associated with the transmitting device.
The plugin can be configured to all received status reports or only
those received from configured modules or specific IP address ranges.  

Receipt of status notifications from a DS device which is configured
for relay output causes the plugin to establish and maintain a
persistent TCP connection to the notifying device allowing subsequent
operation of remote relays in response to Signal K PUT requests on
associated switchbank relay channels.

This operating strategy is resilient to network outage and allows
*ad-hoc* connection of DS devices to a live system without further
operator intervention.

In addition to switchbank monitoring and control the plugin also
provides a mechanism for decorating associated switchbank paths with
automatically generated and user supplied metadata.

The plugin exposes an
[HTTP API](https://pdjr-signalk.github.io/pdjr-skplugin-devantech/)
and contributes documentation of this interface to the Signal K
OpenAPI service.

## Configuration

### Preparing a DS module for use with this plugin

Refer to the DS device user manual for information on how to install
the device and access its configuration dashboard.
Make the following configuration settings under each dashboard tab.

<dl>
  <dt>Network</dt>
  <dd>
    <p>
    Assign the DS device a static IP address on your LAN and specify a
    control port number.
    Make sure that the control port number you choose is not blocked by
    any firewalls on your Signal K host and/or network router.
    If you have more than one DS device on your network, use the same
    port number on every device.
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
    'Target Port' should be set to some preferred value and, if you
    have more than one DS device then the same value should be used
    on all devices.
    Make sure any firewalls in your environment do not block your 
    chosen port.
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

Together thse steps ensure that an event notification message is sent
to the plugin immediately a switch input or relay output on the DS
device changes state.
Virtual relay R32 undergoes a state change every five seconds ensuring
a regular 'heartbeat' status update.

In Linux you can use ```nc``` to confirm status messages are being
transmitted appropriately.

### Plugin configuration

<dl>
  <dt>Metadata publication service configuration <code>metadataPublisher</code></dt>
  <dd>
    Optional object configuring access to a remote metadata publication
    service (a suitable service is implemented by the author's
    <a href='https://github.com/pdjr-signalk/pdjr-skplugin-metadata#readme'>metadata plugin</a>.
    <p>
    If this property is omitted, or if, for whatever reason, metadata cannot
    be published to the specified service then the plugin will inject metadata
    directly into the Signal K tree.</p>
    <dl>
      <dt>Metadata publication endpoint <code>endpoint</code></dt>
      <dd>
        Required URL of an API which will accept Signal K metadata and
        at least insert it into the Signal K tree.
        For example '/plugins/metadata/metadata'.
      </dd>
      <dt>Metadata publication method <code>method</code></dt>
      <dd>
        Optional string specifying the HTTP method which should be used
        to submit metadata to the publication service.
        Defaults to 'POST', but 'PUT' or 'PATCH' may be specified.
      </dd>
      <dt>Metadata publisher credentials <code>credentials</code></dt>
      <dd>
        Required string of the form 'username:password' specifying
        Signal K credentials that will allow access to the publication
        service.
      </dd>
    </dl>
  </dd>
  <dt>Port on which to listen for module status reports <code>statusListenerPort</code></dt>
  <dd>
    <p>
    Optional number specifying the TCP port on which the plugin will
    listen for DS event notificataions.
    Defaults to 28241.
    </p>
    <p>
    This value must match the 'Target port' value specified in the DS
    module's 'Event Notifications' configuration page.
    </p>
  </dd>
  <dt>Process the transmit queue every this many miliseconds <code>transmitQueueHeartbeat</code></dt>
  <dd>
    <p>
    Optional number specifying the transmit queue processing interval
    in milliseconds.
    Defaults to 25.
    </p>
  </dd>
  <dt>Module configurations <code>modules</code></dt>
  <dd>
    <p>
    Required array of *module* objects each of which defines a
    Devantech DS module that will be controlled by the plugin.
    Each entry has the following configuration properties.
    </p>
    <dl>
      <dt>Module IP address <code>ipAddress</code></dt>
      <dd>
        <p>
        Required string specifying the IP address of the module being
        configured.
        </p>
      </dd>
      <dt>Module id <code>id</code></dt>
      <dd>
        <p>
        Optional string specifying an identifier for the module which
        will be used in Signal K switch paths and messages.
        The supplied value must be unique identifier under
        'electrical.switches.bank'.
        </p>
        <p>
        If omitted, then a value for <em>id</em> will be derived from
        <em>ipAddress</em> by transforming a dotted address of the form
        '<em>a.b.c.d</em>' to an id of the form '<em>aaabbbcccddd</em>'.
        </p>
      </dd>
      <dt>Relay operation command port <code>commandPort</code></dt>
      <dd>
        <p>
        Optional number specifying the port on which the module listens
        for relay operating commands.
        This value must match the 'Control port' number specified on the
        DS module's 'Network' configuration page.
        </p>
        <p>
        If omitted, the module will only support switch input channels.
        </p>
      </dd>
      <dt>Password for command port access <code>password</code></dt>
      <dd>
        <p>
        If the DS module was configured with password security, then the
        configured password must be supplied here.
        </p>
      </dd>
      <dt>Device id <code>deviceId</code></dt>
      <dd>
        <p>
        Optional identifier of a <em>device</em> configuration (see below)
        which describes this module's operating protocol.
        </p>
        <p>
        Defaults to 'DS'.
        </p>
      </dd>
      <dt>Description <code>description</code></dt>
      <dd>
        <p>
        Optional text describing the module.
        </p>
      </dd>
      <dt>Channels <code>channels</code></dt>
      <dd>
        <p>
        The channels array property defines the Signal K interface to
        the relay and switch channels supported by the DS module.
        Each item in the *channels* array is an object defining a
        single channel and had the following properties.
        </p>
        <dl>
          <dt>Channel index <code>index</code></dt>
          <dd>
            <p>
            Required string value giving a name which will be used to
            identify the channel in Signal K.
            This name <em>must</em> have the form '<em>nT</em>' where
            <em>n</em> is a decimal channel number in the range 1..
            and <em>T</em> is either 'R' (to identify a relay output
            channel) or 'S' (to identify a switch input channel).
            </p>
          </dd>
          <dt>Description <code>description</code></dt>
          <dd>
            <p>
            Optional text describing the channel.
            </p>
          </dd>
        </dl>
      </dd>
    </dl>
  </dd>
</dl>

The plugin configuration has the following properties.

| Property name          | Value type | Value default | Description |
| :--------------------- | :---------- | :----------- | :---------- |
| modules                | Array       | (none)       | Collection of *module* objects. |
| statusListenerPort     | Number      | 24281        | The TCP port on which the plugin will listen for DS event notificataions. |
| transmitQueueHeartbeat | Number      | 25           | Transmit queue processing interval in milliseconds. |
| devices                | Array       | (see below)  | Collection of *device* objects.|


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


### Example configuration

I use a
[DS2242](https://www.robot-electronics.co.uk/ds2242.html)
(four digital inputs, two relay outputs) as an alarm annunciator at my
ship's helm.

The module's relays operate an LED beacon and a piezo-electric sounder
and are used by an alarm manager plugin in Signal K.
Float switch and level sensor signals from my two bilge installations
are connected to the DS2242 inputs making their states available in
Signal K.

With some tweaking of the DS2242's 'Pulse/Follow' configuration I allow
the bilge sensor inputs to directly drive the module's relay outputs,
making bilge annunciation independent of Signal K.

```
{
  "enabled": true,
  "enableDebug": false,
  "configuration": {
    "metadataPublisher": {
      "endpoint": "/plugins/metadata/metadata",
      "method": "POST",
      "credentials": "username:password"
    },
    "modules": [
      {
        "id": "helm-alarm"
        "ipAddress": "192.168.1.6",
        "commandPort": 17123,
        "description": "DS2242 Helm Alarm Module",
        "channels": [
          { "index": "r-beacon", "address": 1 },
          { "index": "r-sounder", "address": 2 },
          { "index": "s-mc-bilge-float-switch", "address": 1 },
          { "index": "s-mc-bilge-level-sensor", "address": 2 },
          { "index": "s-er-bilge-float-switch", "address": 3 },
          { "index": "s-er-bilge-level-sensor", "address": 4 }
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
