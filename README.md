# pdjr-skplugin-devantech

Signal K interface to
[Devantech](https://www.devantech.co.uk)
DS general-purpose relay modules.

## Description

**pdjr-skplugin-devantech** implements an operating interface for
the DS range of Ethernet relay devices manufactured by Devantech.
An interfaced DS device presents as a Signal K switchbank with
subordinate keys indicating the state of the device's I/O and relay
channels.
PUT requests on relay channels operate the associated physical
relays on an the connected DS device.

Typically DS devices used by Signal K will be installed on the local
network, but it is a simple matter to connect a remote DS device
located elsewhere on the Internet.

DS devices require some trivial initial configuration to make them
usable by the plugin but afterwards will automatically interface
with Signal K as soon as they appear on the host LAN.
Configuration of the plugin is not required, but may be desirable
for the purposes of documentation or required if it is necessary
to override the plugin's default behaviour.

The overall operating strategy is resilient to network outage and
(subject to the presence of an appropriate IP address filter) allows
*ad-hoc* connection of DS devices to a live system without further
operator intervention.

The plugin exposes an
[HTTP API](https://pdjr-signalk.github.io/pdjr-skplugin-devantech/)
and contributes documentation of this interface to the Signal K
OpenAPI service.

## Configuring a DS module for use with this plugin

Refer to the DS device user manual for information on how to access a
device's configuration dashboard and then make the following settings
under each indicated dashboard tab.
<dl>
  <dt>Network</dt>
  <dd>
    <p>
    <ul>
      <li>Uncheck 'Enable DHCP';</li>
      <li>Assign the DS device a static IP address and configure other network properties to suit your LAN.</li>
    </ul>
    </p>
  </dd>
  <dt>TCP/IP</dt>
  <dd>
    <p>
    <uL>
      <li>Check 'ASCII';</li>
      <li>Set 'TCP/IP Port' to 17123.</li>
    </ul>
    </p>  
  <dt>Relays</dt>
  <dd>
    <p>
    For relays 1 to 31:
    <ul>
      <li>Set 'Relay Name' if you wish;</li>
      <li>Set 'Pulse/Follow' to 0;</li>
      <li>Uncheck 'Power-up Restore';</li>
      <li>Set all other fields to blank.</li>
    </ul>
    </p>
    For relay 32:
    <ul>
      <li>Set 'Relay Name' if you wish;</li>
      <li>Set 'Pulse/Follow' to 'C1>4';</li>
      <li>Uncheck 'Power-up Restore';</li>
      <li>Set all other fields to blank.</li>
    </ul>
    <p>
  </dd>
  <dt>Input/Output</dt>
  <dd>
    <p>
    For all I/O channels.
    <ul>
      <li>Set 'Name' if you wish;</li>
      <li>Set 'Type' to 'Digital With Pullup';</li>
      <li>Set 'Attached Relay Number' to 'None'.</li>
    </ul>
    </p>
  </dd>
  <dt>Counter/Timer</dt>
  <dd>
    <p>
    Select 'Counter No.' 1, and:
    <ul>
      <li>Set 'Counter Name' to 'Ctr1' or whatever;</li>
      <li>Set 'Counter Input' to 'T1';</li>
      <li>Set 'Capture Input' to blank;</li>
      <li>Set 'Reset Input" to 'C1>9'.</li>
    </ul>
    </p>
  </dd>
  <dt>Event Notifications</dt>
  <dd>
    <p>
    <ul>
      <li>Set 'Event Triggers' to monitor the physical switch inputs
      and relay outputs supported by the DS device and also the virtual
      relay R32. For example, The DS2242 device has four switch inputs
      and two relay outputs and would be configured as
      '{D1|D2|D3|D4|R1|R2|R32}'.</li>
      <li>Set 'Target IP' to the IP address of the Signal K host.</li>
      <li>Set 'Target Port' to 28241.</li>
      <li>Set 'TCP/IP Timeout' to 100.</li>
      <li>Uncheck 'Timestamp'.
    </ul>
    </p>
  </dd>
</dl>

Together thse steps ensure that an event notification message is sent
to the plugin immediately a switch input or relay output on the DS
device changes state.
Virtual relay R32 undergoes a state change every five seconds ensuring
a regular 'heartbeat' status update.

## Plugin configuration

As long as DS modules are configured using the default values discussed
above, then no explicit plugin configuration is required and use of DS
modules can be considered to be a 'plug-and-play' activity.

However, users may well *want* to supply an enhanced configuration which
includes *description* properties for installed modules and the channels
that they operate.

The full range of available configuration properties is described below.

<dl>
  <dt>Client IP filter <code>clientIpFilter</code></dt>
  <dd>
    <p>
    String containing a regular expression used to determine if a
    connection request from a remote client IP should be accepted.
    </p>
    <p>
    This property may (depending on the user's security sensitivity)
    be optional if the host server is on a private network and
    otherwise must be specified.
    </p>
    <p>
    On a private network a default regular expression which will allow
    connection from any peer on the private network is computed from
    the host server's IP address.
    If better security is required, then a more restrictive regex must
    be supplied.
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
    <p>
    Defaults to 'DS'.
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
                  Required string value identifying ying the channel
                  being configured.
                  This name <em>must</em> have the form '<em>nT</em>'
                  where <em>n</em> is a decimal channel number and
                  <em>T</em> is either 'R' (to identify a relay output
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
  <dt>Devices <code>devices</code></dt>
  <dd>
    <p>
    Required array of <em>device</em> objects each of which defines
    the size of a specific DS device and the commands required to
    operate its relay outputs.
    </p>
    <p>
    The plugin includes an embedded definition for a generic device
    called 'DS' supporting a maximum of eight I/O and 32 relay channels
    and which is compatible with all available DS series devices.
    </p>
    <p> 
    The *devices* array can be used to add additional <em>device</em>
    entries which provide tighter configurations for specific DS
    devices by specifying the exact number of supported I/O and relay
    channels.
    </p>
    <dl>
      <dt>Device</dt>
      <dd>
        <p>
        Characteristics of a single DS device.
        <dl>
          <dt>Device ID <code>id</code></dt>
          <dd>
            <p>
            Required string value giving an dentifier for this
            device definition - typically this should be the model
            number assigned by the device manufacturer.
          </dd>
          <dt>Inputs <code>inputs</code></dt>
          <dd>
            <p>
            Required number value giving the number of input channels
            on this device.
            </p>
          </dd>
          <dt>Relays <code>relays</code></dt>
          <dd>
            <p>
            Required number value giving the number of relay channels
            on this device.
            </p>
          </dd>
          <dt>Channels <code>channels</code></dt>
          <dd>
            <p>
            Required array of 1 or more <em>channel</em> objects each
            of which supplies the operating commands for a particular
            or generic relay output.
            <dl>
              <dt>Channel</dt>
              <dd>
                <p>
                <dl>
                  <dt>Address <code>address</code></dt>
                  <dd>
                    <p>
                    Required number giving the address of the relay
                    channel being configured (in the range
                    1..<em>relays</em>) or 0 if <em>channel</em>
                    defines a global/generic configuration.
                    </p>
                  </dd>
                  <dt>ON command <code>oncommand</code></dt>
                  <dd>
                    <p>
                    Required string supplying the ASCII command that is
                    required to switch this channel on.
                    If this is a generic command then the token '{c}'
                    can be used to indicate where in the command a 
                    specific channel number should be interpolated.
                    </p>
                  </dd>
                  <dt>OFF command <code>offcommand</code></dt>
                  <dd>
                    <p>
                    Required string supplying the ASCII command that is
                    required to switch this channel off.
                    If this is a generic command then the token '{c}'
                    can be used to indicate where in the command a 
                    specific channel number should be interpolated.
                    </p>
                  </dd>
                </dl>
                </p>
              </dd>
            </dl>
            </p>
          </dd>
        </dl>
        </p>
      </dd>
    </dl>
    </p>
  </dd>
</dl>

The module includes the following embedded configuration.
```
{
  "enabled": true,
  "configuration": {
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
      }
    ]
  }
}
```
On my ship I use a small DS device as an alarm annunciator and
configure this in the following way.
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

## Operation

The plugin listens on the configured TCP port for connections from
remote DS devices, rejecting connections from devices with IP addresses
that are not on the local private network and/or which are excluded by
the user-configured filter.

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

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
