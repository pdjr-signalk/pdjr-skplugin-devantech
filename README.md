# pdjr-skplugin-devantech

Signal K interface to
[Devantech](https://www.devantech.co.uk)
DS general-purpose relay modules.

## Description

**pdjr-skplugin-devantech** implements an interface to Devantech DS
range of Ethernet relay devices.

DS devices provide a mix of general purpose analogue and digital I/O
and relay output channels: the number and type of channels varies
across the product range.

The plugin represents DS module channel states as a Signal K path
of the form 'electrical.switches.bank.*address*.*index**type*.state'.
Where *address* is a representation of a DS module's IP address;
*index* is the ordinal number of a channel on the DS module and
*type* is either 'R' or 'S' to indicate whether the path represents
the state of a relay output or a switch input.

The plugin listens on a user-configured TCP port for connections from
remote DS devices, rejecting connections from devices with IP addresses
that are not on the local private network and/or which are excluded by
a user-specified filter.

When an allowed DS device first connects to the plugin a Signal K
switchbank path is created and decorated with metadata which
incorporates any properties that may have been supplied in the plugin
configuration.

Subsequently, the first status update received from a module results
in the creation of a collection of Signal K switch paths for the
associated module and the decoration of these paths with metadata
which incorporates any properties that may have been supplied in the
plugin configuration.
A persistent TCP command connection is opened to the remote DS device
and Signal K relay paths have a handler installed that responds to PUT
requests by sending operating commands over this connection to the
remote DS device.

This operating strategy is resilient to network outage and (subject
to specification of an appropriate IP address filter) allows
*ad-hoc* connection of DS devices to a live system without further
operator intervention.

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
    Assign the DS device a static IP address on your LAN (recommended)
    or use DHCP with a fixed IP address allocation.
    </p>
  </dd>
  <dt>TCP/IP</dt>
  <dd>
    <p>
    Check 'ASCII'.
    Set 'TCP/IPPort' to 17123.
    </p>  
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
    The DS2242 device has two switch inputs and four-relay outputs and
    would be configured as:
    ```{D1|D2|R1|R2|R3|R4|R32}```.
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

As long as DS modules are configured using the expected default values
discussed above, then no explicit plugin configuration is required and
use of DS modules can be considered to be a 'plug-and-play' activity.

Typically, users may want to supply at least descriptions for their
installed modules and the channels they operate.

<dl>
  <dt>Client IP filter <code>clientIpFilter</code></dt>
  <dd>
    <p>
    String containing a regular expression used to determine if a
    connection request from a remote client IP hould be accepted.
    </p>
    <p>
    This property may (depending on the user's security sensitivity)
    be optional if the host server is on a private network and
    otherwise must be specified.
    </p>
    <p>
    On a private network a default regular expression is computed
    from the host server IP address which will allow connection from
    any peer on the private network.
    If you need better security than this, then specify your own, more
    restrictive, regex.
    </p>
  </dd>
  <dt>Status listener port <code>statusListenerPort</code></dt>
  <dd>
    <p>
    Optional number specifying the TCP port on which the plugin will
    listen for DS event notificataions.
    This value must match the 'Target port' value specified in each DS
    module's 'Event Notifications' configuration page.
    </p>
    <p>
    Defaults to 28241.
    </p>
  </dd>
  <dt>Transmit queue heartbeat <code>transmitQueueHeartbeat</code></dt>
  <dd>
    <p>
    Optional number specifying the transmit queue processing interval
    in milliseconds.
    </p>
    <p>
    Defaults to 25.
    </p>
  </dd>
  <dt>Default device identifier <code>defaultDeviceId</code></dt>
  <dd>
    <p>
    Optional string specifying the device identifier that should be
    used for modules which do not define their own <em>deviceId</em>.
    </p>
  </dd>
  <dt>Default command port <code>defaultCommandPort</code></dt>
  <dd>
    <p>
    Optional number specifying the TCP port on which DS modules will
    listen for relay control commands.
    Can be overridden by individual module configuration.
    </p>
    <p>
    Defaults to 17123.
  </dd>
  <dt>Modules <code>modules</code></dt>
  <dd>
    <p>
    Optional array of *module* objects each of which configures a
    Devantech DS module by overriding any top-level defaults and/or by
    specifying particular module or channel properties.
    </p>
    <dl>
      <dt>Module</dt>
      <dd>
        <p>
        Each *module* item in the *modules* array has the following
        configuration properties.
      </p>
      <dl>
        <dt>IP address <code>ipAddress</code></dt>
        <dd>
          <p>
          Required string specifying the IP address of the module being
          configured.
          </p>
        </dd>
        <dt>Command port <code>commandPort</code></dt>
        <dd>
          <p>
          Optional number specifying the port on which this module
          listens for relay operating commands, overriding
          <em>defaultCommandPort</em>.
          This value must match the 'Control port' number specified on
          the associated DS module's 'Network' configuration page.
          </p>
        </dd>
        <dt>Device id <code>deviceId</code></dt>
        <dd>
          <p>
          Optional identifier of a <em>device</em> configuration (see below)
          which describes this module's operating protocol, overriding
          <em>defaultDeviceId</em>.
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
            <dt>Channel</dt>
            <dd>
              <p>
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
    </dl>
  </dd>
</dl>

#### Example configuration file

My ```devantech.json``` configuration file looks like this.

```
{
  "enabled": true,
  "configuration": {

    "modules": [
      {
        "ipAddress": "192.168.1.6",
        "description": "DS2824 Test Module",
        "deviceId": "DS2824",
        "channels": [
          { "index": "1R", "description": "Test output" },
          { "index": "1S", "description": "Test input" }
        ]
      }
    ]
  }
}
```

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
    "modules": [
      {
        "ipAddress": "192.168.1.6",
        "deviceId": "DS2242",
        "description": "DS2242 Helm Alarm Module",
        "channels": [
          { "index": "1R", "description": "Alarm beacon" },
          { "index": "2R", "description": "Alarm sounder" },
          { "index": "1S", "description": "ER bilge pump float switch" },
          { "index": "2S", "description": "ER bilge level sensor" },
          { "index": "3S", "description": "MC bilge pump float switch" },
          { "index": "4S", "description": "MC bilge level sensor" }
        ]
      }
    ],
    "devices": [
      {
        "id": "DS",
        "relays": 32,
        "switches": 8,
        "channels": [
          {
            "address": 0,
            "oncommand": "SR {c} ON",
            "offcommand": "SR {c} OFF"
          }
        ]
      },
      {
        "id": "DS2242",
        "relays": 2,
        "switches": 4,
        "channels": [
          {
            "address": 0,
            "oncommand": "SR {c} ON",
            "offcommand": "SR {c} OFF"
          }
        ]
      }
    ]
  }
}
```

### Device definitions

Each *device* entry in the *devices* array defines the characteristics
of a DS-series device.

The plugin includes the following definition of a device called 'DS'
that provides a configuration which will work for all devices in the DS
range.
```
{
  "id": "DS",
  "relays": 32,
  "switches": 8,
  "channels": [
    {
      "address": 0,
      "oncommand": "SR {c} ON",
      "offcommand": "SR {c} OFF"
    }
  ]
}
```
Additional devices can be added to the *devices* array which provide
tighter configuration for specific DS device models by specifying the
exact number of I/O channels supported by a particular device.

The plugin includes this device definition suitable for DS-series relay
modules:
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
